import type {
  AttachmentRow,
  ChannelMemberRow,
  ChannelRow,
  MessageReactionRow,
  MessageRow,
  ProfileRow,
  UnreadCountRow,
  WorkspaceRow,
} from '../database.types';
import type { Channel, Message, User, UserStatus, Workspace } from '../types';
import { getSupabase, functionsUrl } from '../lib/supabase';
import { MAX_ATTACHMENT_BYTES } from '../lib/limits';
import { ApiError } from './errors';
import { toChannel, toMessage, toUser, toWorkspace } from './mappers';

/**
 * Every call the client makes to the Supabase backend.
 *
 * Reads are deliberately plain selects rather than clever joins: PostgREST
 * applies RLS per table, so a nested select silently returns an empty array
 * for anything the policies exclude. Fetching each table and assembling here
 * keeps that behaviour obvious instead of surprising.
 */


/**
 * Turns transport failures into something a person can act on.
 *
 * A wrong project URL, an offline machine and a CORS rejection all surface as
 * the browser's bare "Failed to fetch", which tells the user nothing.
 */
function describeAuthFailure(error: { message: string; code?: string }): string {
  if (/failed to fetch|networkerror|load failed/i.test(error.message)) {
    return 'Could not reach the server. Check your connection and that VITE_SUPABASE_URL points at your project.';
  }
  return error.message;
}

const SIGNED_URL_TTL_SECONDS = 60 * 60;

function fail(action: string, error: { message: string; code?: string } | null): never {
  throw new ApiError(`${action}: ${error?.message ?? 'unknown error'}`, error?.code);
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export async function signUp(
  email: string,
  password: string,
  fullName: string,
): Promise<{ needsConfirmation: boolean }> {
  const { data, error } = await getSupabase().auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  });
  if (error) throw new ApiError(describeAuthFailure(error), error.code);

  // With email confirmation enabled, a session is withheld until the address
  // is verified.
  return { needsConfirmation: !data.session };
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await getSupabase().auth.signInWithPassword({ email, password });
  if (error) {
    // Supabase returns the same message for a wrong password and an unknown
    // address, which is correct: distinguishing them enumerates accounts.
    throw new ApiError(describeAuthFailure(error), error.code);
  }
}

export async function signOut(): Promise<void> {
  const { error } = await getSupabase().auth.signOut();
  if (error) throw new ApiError(error.message, error.code);
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

export async function fetchProfiles(ids?: string[]): Promise<User[]> {
  let query = getSupabase().from('profiles').select('*');
  if (ids?.length) query = query.in('id', ids);

  const { data, error } = await query;
  if (error) fail('Could not load people', error);
  return (data as ProfileRow[]).map(toUser);
}

export async function updateProfile(
  userId: string,
  patch: { full_name?: string; display_name?: string; title?: string; avatar_url?: string | null },
): Promise<User> {
  const { data, error } = await getSupabase()
    .from('profiles')
    .update(patch)
    .eq('id', userId)
    .select()
    .single();
  if (error) fail('Could not save your profile', error);
  return toUser(data as ProfileRow);
}

export async function setStatus(userId: string, status: UserStatus): Promise<void> {
  const { error } = await getSupabase()
    .from('profiles')
    .update({ status, last_seen_at: new Date().toISOString() })
    .eq('id', userId);
  if (error) fail('Could not update your status', error);
}

// ---------------------------------------------------------------------------
// Workspaces and channels
// ---------------------------------------------------------------------------

export async function fetchWorkspaces(): Promise<Workspace[]> {
  const { data, error } = await getSupabase().from('workspaces').select('*').order('created_at');
  if (error) fail('Could not load workspaces', error);
  return (data as WorkspaceRow[]).map(toWorkspace);
}

export async function createWorkspace(name: string): Promise<Workspace> {
  const { data, error } = await getSupabase().rpc('create_workspace', { p_name: name });
  if (error) fail('Could not create the workspace', error);
  return toWorkspace(data as unknown as WorkspaceRow);
}

export interface ChannelBundle {
  channels: Channel[];
  /** channelId -> ISO timestamp this user last read it. */
  lastReadAt: Record<string, string>;
}

export async function fetchChannels(workspaceId: string): Promise<ChannelBundle> {
  const supabase = getSupabase();

  const { data: channelRows, error: channelError } = await supabase
    .from('channels')
    .select('*')
    .eq('workspace_id', workspaceId);
  if (channelError) fail('Could not load channels', channelError);

  const ids = (channelRows as ChannelRow[]).map((c) => c.id);
  if (ids.length === 0) return { channels: [], lastReadAt: {} };

  const { data: memberRows, error: memberError } = await supabase
    .from('channel_members')
    .select('*')
    .in('channel_id', ids);
  if (memberError) fail('Could not load channel membership', memberError);

  const membersByChannel = new Map<string, string[]>();
  const lastReadAt: Record<string, string> = {};
  const { data: auth } = await supabase.auth.getUser();
  const me = auth?.user?.id;

  for (const row of memberRows as ChannelMemberRow[]) {
    const list = membersByChannel.get(row.channel_id);
    if (list) list.push(row.user_id);
    else membersByChannel.set(row.channel_id, [row.user_id]);

    if (row.user_id === me) lastReadAt[row.channel_id] = row.last_read_at;
  }

  return {
    channels: (channelRows as ChannelRow[]).map((row) =>
      toChannel(row, membersByChannel.get(row.id) ?? []),
    ),
    lastReadAt,
  };
}

export async function createChannel(
  workspaceId: string,
  name: string,
  type: 'public' | 'private',
  description: string,
): Promise<Channel> {
  const { data, error } = await getSupabase().rpc('create_channel', {
    p_workspace_id: workspaceId,
    p_name: name,
    p_type: type,
    p_description: description,
  });
  if (error) fail('Could not create the channel', error);
  const row = data as unknown as ChannelRow;
  const { data: auth } = await getSupabase().auth.getUser();
  return toChannel(row, auth?.user?.id ? [auth.user.id] : []);
}

export async function createDm(workspaceId: string, userIds: string[]): Promise<Channel> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('create_dm', {
    p_workspace_id: workspaceId,
    p_user_ids: userIds,
  });
  if (error) fail('Could not start the conversation', error);

  const row = data as unknown as ChannelRow;
  const { data: members } = await supabase
    .from('channel_members')
    .select('user_id')
    .eq('channel_id', row.id);

  return toChannel(row, (members ?? []).map((m: { user_id: string }) => m.user_id));
}

export async function joinChannel(channelId: string, userId: string): Promise<void> {
  const { error } = await getSupabase()
    .from('channel_members')
    .insert({ channel_id: channelId, user_id: userId });
  if (error) fail('Could not join the channel', error);
}

export async function markChannelRead(channelId: string): Promise<void> {
  const { error } = await getSupabase().rpc('mark_channel_read', { p_channel_id: channelId });
  if (error) fail('Could not update read state', error);
}

export async function fetchUnreadCounts(workspaceId: string): Promise<UnreadCountRow[]> {
  const { data, error } = await getSupabase().rpc('unread_counts', {
    p_workspace_id: workspaceId,
  });
  if (error) fail('Could not load unread counts', error);
  return (data ?? []) as UnreadCountRow[];
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/**
 * Loads a channel's messages newest-first, then returns them oldest-first.
 *
 * The limit applies to the newest end, which is what a chat view actually
 * needs; loading the whole history was the scaling problem fixed on the
 * client in the previous phase and would be worse against a network.
 */
export async function fetchMessages(channelId: string, limit = 80): Promise<Message[]> {
  const supabase = getSupabase();

  const { data: rows, error } = await supabase
    .from('messages')
    .select('*')
    .eq('channel_id', channelId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) fail('Could not load messages', error);

  const messageRows = (rows as MessageRow[]).slice().reverse();
  if (messageRows.length === 0) return [];

  const ids = messageRows.map((m) => m.id);

  const [{ data: reactionRows }, { data: attachmentRows }] = await Promise.all([
    supabase.from('message_reactions').select('*').in('message_id', ids),
    supabase.from('attachments').select('*').in('message_id', ids),
  ]);

  const reactionsByMessage = new Map<string, MessageReactionRow[]>();
  for (const row of (reactionRows ?? []) as MessageReactionRow[]) {
    const list = reactionsByMessage.get(row.message_id);
    if (list) list.push(row);
    else reactionsByMessage.set(row.message_id, [row]);
  }

  const attachmentsByMessage = new Map<string, AttachmentRow[]>();
  for (const row of (attachmentRows ?? []) as AttachmentRow[]) {
    const list = attachmentsByMessage.get(row.message_id);
    if (list) list.push(row);
    else attachmentsByMessage.set(row.message_id, [row]);
  }

  return messageRows.map((row) =>
    toMessage(row, reactionsByMessage.get(row.id) ?? [], attachmentsByMessage.get(row.id) ?? []),
  );
}

export async function sendMessage(input: {
  channelId: string;
  parentId: string | null;
  userId: string;
  text: string;
  files?: File[];
}): Promise<Message> {
  const supabase = getSupabase();

  /*
   * Files are uploaded first, then the message and its attachment rows are
   * written in a single transaction by send_message().
   *
   * The previous order - insert the message, then attach - left a window where
   * a message existed without its files, and a failure partway through
   * stranded storage objects that nothing referenced. It also cannot satisfy
   * the deferred "a message must have content" constraint, because PostgREST
   * runs each request in its own transaction.
   */
  const uploaded: UploadedFile[] = [];

  try {
    for (const file of input.files ?? []) {
      uploaded.push(await uploadFile(input.channelId, file));
    }

    const { data, error } = await supabase.rpc('send_message', {
      p_channel_id: input.channelId,
      p_body: input.text,
      p_parent_id: input.parentId,
      p_attachments: uploaded.map((u) => ({
        storage_path: u.storagePath,
        name: u.name,
        mime_type: u.mimeType,
        size_bytes: u.size,
      })),
    });

    if (error) fail('Could not send the message', error);

    const row = data as unknown as MessageRow;
    return {
      ...toMessage(row, [], []),
      attachments: uploaded.map((u, index) => ({
        id: `pending-${index}`,
        name: u.name,
        mimeType: u.mimeType,
        size: u.size,
        storagePath: u.storagePath,
      })),
    };
  } catch (err) {
    // Do not leave uploaded objects behind if the message never landed.
    if (uploaded.length > 0) {
      await supabase.storage.from('attachments').remove(uploaded.map((u) => u.storagePath));
    }
    throw err;
  }
}

export async function editMessage(messageId: string, text: string): Promise<void> {
  const { error } = await getSupabase().from('messages').update({ body: text }).eq('id', messageId);
  if (error) fail('Could not save the edit', error);
}

export async function deleteMessage(messageId: string): Promise<void> {
  const supabase = getSupabase();

  // Remove the stored files first: the attachment rows cascade away with the
  // message, and once they are gone nothing records where the objects live.
  const { data: attachments } = await supabase
    .from('attachments')
    .select('storage_path')
    .eq('message_id', messageId);

  const paths = (attachments ?? []).map((a: { storage_path: string }) => a.storage_path);
  if (paths.length > 0) {
    await supabase.storage.from('attachments').remove(paths);
  }

  const { error } = await supabase.from('messages').delete().eq('id', messageId);
  if (error) fail('Could not delete the message', error);
}

export async function toggleReaction(messageId: string, emoji: string): Promise<boolean> {
  const { data, error } = await getSupabase().rpc('toggle_reaction', {
    p_message_id: messageId,
    p_emoji: emoji,
  });
  if (error) fail('Could not update the reaction', error);
  return Boolean(data);
}

export async function searchMessages(
  workspaceId: string,
  query: string,
  limit = 50,
): Promise<Message[]> {
  const { data, error } = await getSupabase().rpc('search_messages', {
    p_workspace_id: workspaceId,
    p_query: query,
    p_limit: limit,
  });
  if (error) fail('Search failed', error);

  return (data ?? []).map((row) =>
    toMessage({
      id: row.id,
      channel_id: row.channel_id,
      parent_id: row.parent_id,
      user_id: row.user_id,
      body: row.body,
      created_at: row.created_at,
      edited_at: null,
    }),
  );
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

interface UploadedFile {
  storagePath: string;
  name: string;
  mimeType: string;
  size: number;
}

/** Puts one file in the bucket. The attachment row is written by send_message. */
async function uploadFile(channelId: string, file: File): Promise<UploadedFile> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new ApiError(`${file.name} is larger than the 5 MB limit.`);
  }

  // The first path segment is the channel id: the storage policy reads it to
  // decide access, so it must be the real id and not caller-chosen text.
  const safeName = file.name.replace(/[^\w.\- ]+/g, '_').slice(-120);
  const storagePath = `${channelId}/${crypto.randomUUID()}-${safeName}`;

  const { error } = await getSupabase()
    .storage.from('attachments')
    .upload(storagePath, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });
  if (error) throw new ApiError(`Could not upload ${file.name}: ${error.message}`);

  return {
    storagePath,
    name: file.name.slice(0, 255),
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
  };
}

/** Short-lived URL for a private object. The bucket is never public. */
export async function signedAttachmentUrl(storagePath: string): Promise<string | null> {
  const { data, error } = await getSupabase()
    .storage.from('attachments')
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (error) return null;
  return data?.signedUrl ?? null;
}

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

export async function requestAiSummary(input: {
  mode: 'channel_recap' | 'thread_summary';
  channelId: string;
  rootMessageId?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const supabase = getSupabase();
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new ApiError('Sign in to use AI features.');

  const response = await fetch(functionsUrl('ai'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      mode: input.mode,
      channelId: input.channelId,
      rootMessageId: input.rootMessageId,
    }),
    ...(input.signal ? { signal: input.signal } : {}),
  });

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      typeof (payload as { error?: unknown })?.error === 'string'
        ? ((payload as { error: string }).error)
        : 'The AI request failed.';
    throw new ApiError(message, String(response.status));
  }

  const text = (payload as { text?: unknown })?.text;
  if (typeof text !== 'string' || !text.trim()) {
    throw new ApiError('The model returned an empty response.');
  }
  return text;
}

/** How many AI requests this user has made in the last hour. */
export async function countRecentAiRequests(): Promise<number> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error } = await getSupabase()
    .from('ai_requests')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', since);
  if (error) return 0;
  return count ?? 0;
}
