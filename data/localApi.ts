import type {
  AttachmentRow,
  ChannelMemberRow,
  ChannelRow,
  MessageReactionRow,
  MessageRow,
  ProfileRow,
  UnreadCountRow,
  WorkspaceMemberRow,
  WorkspaceRow,
} from '../database.types';
import type { Channel, Message, User, UserStatus, Workspace } from '../types';
import { MAX_MESSAGE_LENGTH } from '../lib/limits';
import { normaliseChannelName } from '../lib/channelName';
import { ApiError } from './errors';
import { toChannel, toMessage, toUser, toWorkspace } from './mappers';
import type { ChannelBundle } from './remoteApi';

/**
 * Local mode: the same API as remoteApi.ts, backed by this browser's storage.
 *
 * Used when no Supabase project is configured, so a deployment without a
 * backend is still a working app instead of a setup screen. Everything lives
 * in localStorage on one device: there are no other real people, nothing
 * syncs, and clearing site data erases it. The rules the database enforces -
 * membership, who may edit what, the size limits - are mirrored here so the
 * app behaves the same way in both modes.
 */

const DB_KEY = 'chimeway:local-db';
const SESSION_KEY = 'chimeway:local-session';
const FILE_KEY_PREFIX = 'chimeway:local-file:';
const DB_VERSION = 1;

/** localStorage holds roughly 5 MB per site, so files are kept much smaller here. */
export const LOCAL_MAX_ATTACHMENT_BYTES = 1024 * 1024;

export const DEMO_EMAIL = 'demo@chimeway.app';
export const DEMO_PASSWORD = 'demo1234';

interface LocalAccount {
  userId: string;
  email: string;
  salt: string;
  passwordHash: string;
}

interface LocalDb {
  version: number;
  accounts: LocalAccount[];
  profiles: ProfileRow[];
  workspaces: WorkspaceRow[];
  workspaceMembers: WorkspaceMemberRow[];
  channels: ChannelRow[];
  channelMembers: ChannelMemberRow[];
  messages: MessageRow[];
  reactions: MessageReactionRow[];
  attachments: AttachmentRow[];
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

let cached: LocalDb | null = null;

function now(): string {
  return new Date().toISOString();
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function persist(db: LocalDb): void {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  } catch {
    throw new ApiError('This browser is out of storage space for Chimeway data.');
  }
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function load(): Promise<LocalDb> {
  if (cached) return cached;
  const stored = readJson<LocalDb>(DB_KEY);
  cached = stored?.version === DB_VERSION ? stored : await seed();
  if (cached !== stored) persist(cached);
  return cached;
}

/** Runs a change against the database and saves it, all or nothing. */
async function mutate<T>(change: (db: LocalDb) => T | Promise<T>): Promise<T> {
  const db = await load();
  const draft = structuredClone(db);
  const result = await change(draft);
  persist(draft);
  cached = draft;
  return result;
}

/** Forgets the in-memory copy. Tests use it to start from a clean slate. */
export function resetLocalCache(): void {
  cached = null;
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

function profile(id: string, fullName: string, handle: string, title: string): ProfileRow {
  const at = now();
  return {
    id,
    full_name: fullName,
    display_name: handle,
    title,
    avatar_url: null,
    status: 'offline',
    last_seen_at: at,
    created_at: at,
    updated_at: at,
  };
}

/**
 * A small workspace so a first visit has something in it, plus a demo account
 * anyone can sign in with. Alice and Bob have no passwords; they exist to make
 * the conversation look like one.
 */
async function seed(): Promise<LocalDb> {
  const alice = crypto.randomUUID();
  const bob = crypto.randomUUID();
  const demo = crypto.randomUUID();
  const workspace = crypto.randomUUID();
  const general = crypto.randomUUID();
  const random = crypto.randomUUID();
  const salt = crypto.randomUUID();
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

  const welcome = crypto.randomUUID();
  const messages: MessageRow[] = [
    { id: welcome, channel_id: general, parent_id: null, user_id: alice, body: 'Welcome to Chimeway. 🎉', created_at: minutesAgo(120), edited_at: null },
    { id: crypto.randomUUID(), channel_id: general, parent_id: welcome, user_id: bob, body: 'Glad to be here!', created_at: minutesAgo(118), edited_at: null },
    { id: crypto.randomUUID(), channel_id: general, parent_id: null, user_id: bob, body: 'This copy is running in **local mode**: everything you post is saved in this browser only.', created_at: minutesAgo(60), edited_at: null },
    { id: crypto.randomUUID(), channel_id: random, parent_id: null, user_id: alice, body: 'Anyone up for lunch?', created_at: minutesAgo(30), edited_at: null },
  ];

  const members = (channel: string, at: string): ChannelMemberRow[] =>
    [alice, bob, demo].map((user_id) => ({ channel_id: channel, user_id, joined_at: at, last_read_at: at }));

  const start = minutesAgo(180);
  return {
    version: DB_VERSION,
    accounts: [
      { userId: demo, email: DEMO_EMAIL, salt, passwordHash: await hashPassword(DEMO_PASSWORD, salt) },
    ],
    profiles: [
      profile(alice, 'Alice Nakamura', 'alice', 'Product'),
      profile(bob, 'Bob Okafor', 'bob', 'Engineering'),
      profile(demo, 'Demo User', 'demo', ''),
    ],
    workspaces: [
      { id: workspace, name: 'Acme Inc.', initials: 'AI', color: '#1264a3', created_by: alice, created_at: start },
    ],
    workspaceMembers: [
      { workspace_id: workspace, user_id: alice, role: 'owner', joined_at: start },
      { workspace_id: workspace, user_id: bob, role: 'member', joined_at: start },
      { workspace_id: workspace, user_id: demo, role: 'member', joined_at: start },
    ],
    channels: [
      { id: general, workspace_id: workspace, type: 'public', name: 'general', description: 'Company-wide announcements and chat.', created_by: alice, created_at: start },
      { id: random, workspace_id: workspace, type: 'public', name: 'random', description: 'Anything goes.', created_by: alice, created_at: start },
    ],
    channelMembers: [...members(general, start), ...members(random, start)],
    messages,
    reactions: [{ message_id: welcome, user_id: bob, emoji: '👋', created_at: minutesAgo(119) }],
    attachments: [],
  };
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

type AuthListener = (userId: string | null) => void;
const authListeners = new Set<AuthListener>();

export function getLocalSessionUserId(): string | null {
  return readJson<{ userId: string }>(SESSION_KEY)?.userId ?? null;
}

export function onLocalAuthChange(listener: AuthListener): () => void {
  authListeners.add(listener);
  return () => authListeners.delete(listener);
}

function setSession(userId: string | null): void {
  try {
    if (userId) localStorage.setItem(SESSION_KEY, JSON.stringify({ userId }));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // The session still applies to this page load.
  }
  for (const listener of authListeners) listener(userId);
}

function requireUser(): string {
  const userId = getLocalSessionUserId();
  if (!userId) throw new ApiError('Sign in to continue.');
  return userId;
}

// ---------------------------------------------------------------------------
// Rules shared by several calls (mirrors app.* functions in the migrations)
// ---------------------------------------------------------------------------

function isWorkspaceMember(db: LocalDb, workspaceId: string, userId: string): boolean {
  return db.workspaceMembers.some((m) => m.workspace_id === workspaceId && m.user_id === userId);
}

function isChannelMember(db: LocalDb, channelId: string, userId: string): boolean {
  return db.channelMembers.some((m) => m.channel_id === channelId && m.user_id === userId);
}

function canSeeChannel(db: LocalDb, channel: ChannelRow, userId: string): boolean {
  if (channel.type === 'public') return isWorkspaceMember(db, channel.workspace_id, userId);
  return isChannelMember(db, channel.id, userId);
}

function findChannel(db: LocalDb, channelId: string): ChannelRow {
  const channel = db.channels.find((c) => c.id === channelId);
  if (!channel) throw new ApiError('That conversation no longer exists.');
  return channel;
}

function generateHandle(db: LocalDb, seedText: string): string {
  let base = seedText.toLowerCase().replace(/[^a-z0-9._-]/g, '').replace(/^[._-]+/, '');
  if (base.length < 2) base = 'user';
  base = base.slice(0, 24);
  const taken = new Set(db.profiles.map((p) => p.display_name.toLowerCase()));
  let candidate = base;
  for (let suffix = 1; taken.has(candidate); suffix++) candidate = `${base}${suffix}`;
  return candidate;
}

function mentionPattern(handle: string): RegExp {
  return new RegExp(`@${handle.replace(/\./g, '\\.')}($|[^a-z0-9._-])`);
}

function validateBody(text: string, hasFiles: boolean): string {
  const body = text.trim();
  if (!body && !hasFiles) throw new ApiError('A message needs text or an attachment.');
  if (body.length > MAX_MESSAGE_LENGTH) {
    throw new ApiError(`Messages are limited to ${MAX_MESSAGE_LENGTH} characters.`);
  }
  return body;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export async function signUp(
  email: string,
  password: string,
  fullName: string,
): Promise<{ needsConfirmation: boolean }> {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new ApiError('Enter a valid email address.');
  }
  if (password.length < 8) throw new ApiError('Password should be at least 8 characters.');

  const userId = await mutate(async (db) => {
    if (db.accounts.some((a) => a.email === normalized)) {
      throw new ApiError('An account with this email already exists in this browser.');
    }

    const id = crypto.randomUUID();
    const salt = crypto.randomUUID();
    db.accounts.push({ userId: id, email: normalized, salt, passwordHash: await hashPassword(password, salt) });

    const local = normalized.split('@')[0] ?? '';
    const name = fullName.trim() || local.replace(/\./g, ' ') || 'New user';
    db.profiles.push(profile(id, name, generateHandle(db, local), ''));

    // Join every workspace and its public channels, so a new account lands
    // somewhere with people in it rather than an empty app.
    const at = now();
    for (const workspace of db.workspaces) {
      db.workspaceMembers.push({ workspace_id: workspace.id, user_id: id, role: 'member', joined_at: at });
    }
    for (const channel of db.channels.filter((c) => c.type === 'public')) {
      db.channelMembers.push({ channel_id: channel.id, user_id: id, joined_at: at, last_read_at: '1970-01-01T00:00:00.000Z' });
    }
    return id;
  });

  setSession(userId);
  return { needsConfirmation: false };
}

export async function signIn(email: string, password: string): Promise<void> {
  const db = await load();
  const account = db.accounts.find((a) => a.email === email.trim().toLowerCase());
  // One message for both cases, as Supabase does, so it reveals nothing.
  const invalid = new ApiError('Invalid login credentials');
  if (!account) throw invalid;
  if ((await hashPassword(password, account.salt)) !== account.passwordHash) throw invalid;
  setSession(account.userId);
}

export async function signOut(): Promise<void> {
  setSession(null);
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

export async function fetchProfiles(ids?: string[]): Promise<User[]> {
  const db = await load();
  const rows = ids?.length ? db.profiles.filter((p) => ids.includes(p.id)) : db.profiles;
  return rows.map(toUser);
}

export async function updateProfile(
  userId: string,
  patch: { full_name?: string; display_name?: string; title?: string; avatar_url?: string | null },
): Promise<User> {
  if (userId !== requireUser()) throw new ApiError('You can only edit your own profile.');
  return mutate((db) => {
    const row = db.profiles.find((p) => p.id === userId);
    if (!row) throw new ApiError('Profile not found.');
    if (patch.display_name !== undefined) {
      const handle = patch.display_name.trim().toLowerCase();
      if (!/^[a-z0-9._-]{2,32}$/.test(handle)) {
        throw new ApiError('Display names use 2-32 letters, numbers, dots, dashes or underscores.');
      }
      if (db.profiles.some((p) => p.id !== userId && p.display_name.toLowerCase() === handle)) {
        throw new ApiError('That display name is taken.');
      }
      row.display_name = handle;
    }
    if (patch.full_name !== undefined) row.full_name = patch.full_name.trim();
    if (patch.title !== undefined) row.title = patch.title.trim();
    if (patch.avatar_url !== undefined) row.avatar_url = patch.avatar_url;
    row.updated_at = now();
    return toUser(row);
  });
}

export async function setStatus(userId: string, status: UserStatus): Promise<void> {
  if (userId !== requireUser()) throw new ApiError('You can only change your own status.');
  await mutate((db) => {
    const row = db.profiles.find((p) => p.id === userId);
    if (row) {
      row.status = status;
      row.last_seen_at = now();
    }
  });
}

// ---------------------------------------------------------------------------
// Workspaces and channels
// ---------------------------------------------------------------------------

export async function fetchWorkspaces(): Promise<Workspace[]> {
  const me = requireUser();
  const db = await load();
  return db.workspaces
    .filter((w) => isWorkspaceMember(db, w.id, me))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map(toWorkspace);
}

export async function createWorkspace(name: string): Promise<Workspace> {
  const me = requireUser();
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 80) {
    throw new ApiError('Workspace name must be 1-80 characters.');
  }
  return mutate((db) => {
    const at = now();
    const initials = trimmed.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase() || 'WS';
    const workspace: WorkspaceRow = {
      id: crypto.randomUUID(),
      name: trimmed,
      initials,
      color: '#1264a3',
      created_by: me,
      created_at: at,
    };
    const general: ChannelRow = {
      id: crypto.randomUUID(),
      workspace_id: workspace.id,
      type: 'public',
      name: 'general',
      description: 'Workspace-wide announcements and chat.',
      created_by: me,
      created_at: at,
    };
    db.workspaces.push(workspace);
    db.workspaceMembers.push({ workspace_id: workspace.id, user_id: me, role: 'owner', joined_at: at });
    db.channels.push(general);
    db.channelMembers.push({ channel_id: general.id, user_id: me, joined_at: at, last_read_at: at });
    return toWorkspace(workspace);
  });
}

export async function fetchChannels(workspaceId: string): Promise<ChannelBundle> {
  const me = requireUser();
  const db = await load();
  const visible = db.channels.filter(
    (c) => c.workspace_id === workspaceId && canSeeChannel(db, c, me),
  );

  const lastReadAt: Record<string, string> = {};
  const channels = visible.map((row) => {
    const members = db.channelMembers.filter((m) => m.channel_id === row.id);
    const mine = members.find((m) => m.user_id === me);
    if (mine) lastReadAt[row.id] = mine.last_read_at;
    return toChannel(row, members.map((m) => m.user_id));
  });

  return { channels, lastReadAt };
}

export async function createChannel(
  workspaceId: string,
  name: string,
  type: 'public' | 'private',
  description: string,
): Promise<Channel> {
  const me = requireUser();
  return mutate((db) => {
    if (!isWorkspaceMember(db, workspaceId, me)) {
      throw new ApiError('You are not a member of this workspace.');
    }
    const normalized = normaliseChannelName(name);
    if (!normalized) {
      throw new ApiError('Channel names use lowercase letters, numbers, dashes and underscores.');
    }
    if (
      db.channels.some(
        (c) => c.workspace_id === workspaceId && c.type !== 'dm' && c.name === normalized,
      )
    ) {
      throw new ApiError(`#${normalized} already exists.`);
    }

    const at = now();
    const row: ChannelRow = {
      id: crypto.randomUUID(),
      workspace_id: workspaceId,
      type,
      name: normalized,
      description: description.trim().slice(0, 500),
      created_by: me,
      created_at: at,
    };
    db.channels.push(row);
    db.channelMembers.push({ channel_id: row.id, user_id: me, joined_at: at, last_read_at: at });
    return toChannel(row, [me]);
  });
}

export async function createDm(workspaceId: string, userIds: string[]): Promise<Channel> {
  const me = requireUser();
  return mutate((db) => {
    if (!isWorkspaceMember(db, workspaceId, me)) {
      throw new ApiError('You are not a member of this workspace.');
    }
    const participants = [...new Set([me, ...userIds])].sort();
    if (participants.some((id) => !isWorkspaceMember(db, workspaceId, id))) {
      throw new ApiError('Everyone in a conversation must be in this workspace.');
    }

    // Reuse an existing conversation between exactly these people.
    const existing = db.channels.find((c) => {
      if (c.workspace_id !== workspaceId || c.type !== 'dm') return false;
      const members = db.channelMembers
        .filter((m) => m.channel_id === c.id)
        .map((m) => m.user_id)
        .sort();
      return members.join(',') === participants.join(',');
    });
    if (existing) return toChannel(existing, participants);

    const at = now();
    const row: ChannelRow = {
      id: crypto.randomUUID(),
      workspace_id: workspaceId,
      type: 'dm',
      name: '',
      description: '',
      created_by: me,
      created_at: at,
    };
    db.channels.push(row);
    for (const user_id of participants) {
      db.channelMembers.push({ channel_id: row.id, user_id, joined_at: at, last_read_at: at });
    }
    return toChannel(row, participants);
  });
}

export async function joinChannel(channelId: string, userId: string): Promise<void> {
  if (userId !== requireUser()) throw new ApiError('You can only join channels yourself.');
  await mutate((db) => {
    const channel = findChannel(db, channelId);
    if (channel.type !== 'public' || !isWorkspaceMember(db, channel.workspace_id, userId)) {
      throw new ApiError('This channel is not open to join.');
    }
    if (isChannelMember(db, channelId, userId)) return;
    const at = now();
    db.channelMembers.push({ channel_id: channelId, user_id: userId, joined_at: at, last_read_at: at });
  });
}

export async function markChannelRead(channelId: string): Promise<void> {
  const me = requireUser();
  await mutate((db) => {
    const row = db.channelMembers.find((m) => m.channel_id === channelId && m.user_id === me);
    if (row) row.last_read_at = now();
  });
}

export async function fetchUnreadCounts(workspaceId: string): Promise<UnreadCountRow[]> {
  const me = requireUser();
  const db = await load();
  const handle = db.profiles.find((p) => p.id === me)?.display_name.toLowerCase() ?? '';
  const pattern = mentionPattern(handle);

  return db.channelMembers
    .filter((m) => m.user_id === me)
    .filter((m) => db.channels.some((c) => c.id === m.channel_id && c.workspace_id === workspaceId))
    .map((membership) => {
      const unread = db.messages.filter(
        (msg) =>
          msg.channel_id === membership.channel_id &&
          msg.created_at > membership.last_read_at &&
          msg.user_id !== me,
      );
      return {
        channel_id: membership.channel_id,
        unread_count: unread.length,
        has_mention: unread.some((msg) => pattern.test(msg.body.toLowerCase())),
      };
    });
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

function assertCanRead(db: LocalDb, channelId: string, userId: string): void {
  if (!canSeeChannel(db, findChannel(db, channelId), userId)) {
    throw new ApiError('You do not have access to this conversation.');
  }
}

export async function fetchMessages(channelId: string, limit = 80): Promise<Message[]> {
  const me = requireUser();
  const db = await load();
  assertCanRead(db, channelId, me);

  return db.messages
    .filter((m) => m.channel_id === channelId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .slice(-limit)
    .map((row) =>
      toMessage(
        row,
        db.reactions.filter((r) => r.message_id === row.id),
        db.attachments.filter((a) => a.message_id === row.id),
      ),
    );
}

async function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new ApiError(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

export async function sendMessage(input: {
  channelId: string;
  parentId: string | null;
  userId: string;
  text: string;
  files?: File[];
}): Promise<Message> {
  const me = requireUser();
  if (input.userId !== me) throw new ApiError('You can only post as yourself.');
  const files = input.files ?? [];
  const body = validateBody(input.text, files.length > 0);

  for (const file of files) {
    if (file.size > LOCAL_MAX_ATTACHMENT_BYTES) {
      throw new ApiError(`${file.name} is larger than the 1 MB limit for files stored in this browser.`);
    }
  }

  const stored: string[] = [];
  try {
    return await mutate(async (db) => {
      if (!isChannelMember(db, input.channelId, me)) {
        throw new ApiError('Join this channel to post in it.');
      }
      if (input.parentId) {
        const parent = db.messages.find((m) => m.id === input.parentId);
        if (!parent || parent.channel_id !== input.channelId || parent.parent_id) {
          throw new ApiError('Replies must belong to a top-level message in the same channel.');
        }
      }

      const row: MessageRow = {
        id: crypto.randomUUID(),
        channel_id: input.channelId,
        parent_id: input.parentId,
        user_id: me,
        body,
        created_at: now(),
        edited_at: null,
      };

      const attachments: AttachmentRow[] = [];
      for (const file of files) {
        const safeName = file.name.replace(/[^\w.\- ]+/g, '_').slice(-120);
        const storagePath = `${input.channelId}/${crypto.randomUUID()}-${safeName}`;
        try {
          localStorage.setItem(FILE_KEY_PREFIX + storagePath, await readAsDataUrl(file));
        } catch (err) {
          if (err instanceof ApiError) throw err;
          throw new ApiError(`There is not enough browser storage left to keep ${file.name}.`);
        }
        stored.push(storagePath);
        attachments.push({
          id: crypto.randomUUID(),
          message_id: row.id,
          storage_path: storagePath,
          name: file.name.slice(0, 255),
          mime_type: file.type || 'application/octet-stream',
          size_bytes: file.size,
          created_at: row.created_at,
        });
      }

      db.messages.push(row);
      db.attachments.push(...attachments);
      return toMessage(row, [], attachments);
    });
  } catch (err) {
    for (const path of stored) localStorage.removeItem(FILE_KEY_PREFIX + path);
    throw err;
  }
}

function ownMessage(db: LocalDb, messageId: string, userId: string): MessageRow {
  const row = db.messages.find((m) => m.id === messageId);
  if (!row) throw new ApiError('That message no longer exists.');
  if (row.user_id !== userId) throw new ApiError('You can only change your own messages.');
  return row;
}

export async function editMessage(messageId: string, text: string): Promise<void> {
  const me = requireUser();
  await mutate((db) => {
    const row = ownMessage(db, messageId, me);
    const hasFiles = db.attachments.some((a) => a.message_id === messageId);
    row.body = validateBody(text, hasFiles);
    row.edited_at = now();
  });
}

export async function deleteMessage(messageId: string): Promise<void> {
  const me = requireUser();
  await mutate((db) => {
    ownMessage(db, messageId, me);
    // Replies go with their root, matching the database cascade.
    const doomed = new Set(
      db.messages.filter((m) => m.id === messageId || m.parent_id === messageId).map((m) => m.id),
    );
    for (const attachment of db.attachments.filter((a) => doomed.has(a.message_id))) {
      localStorage.removeItem(FILE_KEY_PREFIX + attachment.storage_path);
    }
    db.messages = db.messages.filter((m) => !doomed.has(m.id));
    db.reactions = db.reactions.filter((r) => !doomed.has(r.message_id));
    db.attachments = db.attachments.filter((a) => !doomed.has(a.message_id));
  });
}

export async function toggleReaction(messageId: string, emoji: string): Promise<boolean> {
  const me = requireUser();
  return mutate((db) => {
    const message = db.messages.find((m) => m.id === messageId);
    if (!message) throw new ApiError('That message no longer exists.');
    assertCanRead(db, message.channel_id, me);

    const index = db.reactions.findIndex(
      (r) => r.message_id === messageId && r.user_id === me && r.emoji === emoji,
    );
    if (index >= 0) {
      db.reactions.splice(index, 1);
      return false;
    }
    db.reactions.push({ message_id: messageId, user_id: me, emoji, created_at: now() });
    return true;
  });
}

export async function searchMessages(
  workspaceId: string,
  query: string,
  limit = 50,
): Promise<Message[]> {
  const me = requireUser();
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];

  const db = await load();
  const channels = new Set(
    db.channels
      .filter((c) => c.workspace_id === workspaceId && isChannelMember(db, c.id, me))
      .map((c) => c.id),
  );

  return db.messages
    .filter((m) => channels.has(m.channel_id) && m.body.toLowerCase().includes(needle))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, Math.min(Math.max(limit, 1), 200))
    .map((row) => toMessage(row));
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

export async function signedAttachmentUrl(storagePath: string): Promise<string | null> {
  try {
    return localStorage.getItem(FILE_KEY_PREFIX + storagePath);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

export async function requestAiSummary(_input: {
  mode: 'channel_recap' | 'thread_summary';
  channelId: string;
  rootMessageId?: string;
  signal?: AbortSignal;
}): Promise<string> {
  throw new ApiError(
    'AI summaries need the Supabase backend, which holds the API key. They are unavailable in local mode.',
    'local_mode',
  );
}

export async function countRecentAiRequests(): Promise<number> {
  return 0;
}
