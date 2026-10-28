import type { Channel, Message, PersistedState, User } from '../types';

/**
 * Pure derivations over the client-side cache.
 *
 * Unread counts and full-text search deliberately live in the database, not
 * here: the cache holds only the channels that have been opened, so deriving
 * either locally would quietly report on a fraction of the data.
 */

export function userById(state: PersistedState, userId: string): User | undefined {
  return state.users.find((u) => u.id === userId);
}

export function currentUser(state: PersistedState): User | undefined {
  return userById(state, state.currentUserId);
}

export function channelById(state: PersistedState, channelId: string): Channel | undefined {
  return state.channels.find((c) => c.id === channelId);
}

export function workspaceChannels(state: PersistedState, workspaceId: string): Channel[] {
  return state.channels.filter((c) => c.workspaceId === workspaceId);
}

/** Top-level messages for a channel, oldest first. Thread replies excluded. */
export function rootMessages(state: PersistedState, channelId: string): Message[] {
  return state.messages
    .filter((m) => m.channelId === channelId && m.parentId === null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Replies to a root message, oldest first. */
export function threadReplies(state: PersistedState, rootId: string): Message[] {
  return state.messages
    .filter((m) => m.parentId === rootId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function replyCount(state: PersistedState, rootId: string): number {
  return state.messages.reduce((n, m) => (m.parentId === rootId ? n + 1 : n), 0);
}

/**
 * Reply counts for every root message, built in one pass.
 *
 * Calling `replyCount` per rendered message is O(n^2) and became the dominant
 * cost in channels with a few hundred messages.
 */
export function replyCountsByRoot(state: PersistedState): Map<string, number> {
  const counts = new Map<string, number>();
  for (const m of state.messages) {
    if (m.parentId === null) continue;
    counts.set(m.parentId, (counts.get(m.parentId) ?? 0) + 1);
  }
  return counts;
}

/** Users keyed by id, so lookups during render are O(1) instead of a scan. */
export function usersById(state: PersistedState): Map<string, User> {
  return new Map(state.users.map((u) => [u.id, u]));
}

/** ISO timestamp of the most recent message in a channel, or the creation time. */
function lastActivityAt(state: PersistedState, channel: Channel): string {
  let latest = channel.createdAt;
  for (const m of state.messages) {
    if (m.channelId === channel.id && m.createdAt > latest) latest = m.createdAt;
  }
  return latest;
}

/** The members of a DM other than the viewer. */
export function dmCounterparts(state: PersistedState, channel: Channel): User[] {
  return channel.memberIds
    .filter((id) => id !== state.currentUserId)
    .map((id) => userById(state, id))
    .filter((u): u is User => Boolean(u));
}

/**
 * Display label for any channel. DM labels are derived from current member
 * names, so renaming a person updates their conversations - the original
 * stored a frozen string like "Charlie, Diana".
 */
export function channelLabel(state: PersistedState, channel: Channel): string {
  if (channel.type !== 'dm') return channel.name;
  const others = dmCounterparts(state, channel);
  if (others.length === 0) return 'Just you';
  if (others.length <= 2) return others.map((u) => u.name).join(', ');
  return `${others[0]?.name ?? ''} and ${others.length - 1} others`;
}

export function channelMembers(state: PersistedState, channel: Channel): User[] {
  return channel.memberIds
    .map((id) => userById(state, id))
    .filter((u): u is User => Boolean(u));
}

/** Channels in a workspace the viewer belongs to, split by kind and sorted. */
export function visibleChannels(
  state: PersistedState,
  workspaceId: string,
): { public: Channel[]; private: Channel[]; dms: Channel[] } {
  const mine = state.channels.filter(
    (c) => c.workspaceId === workspaceId && c.memberIds.includes(state.currentUserId),
  );

  const byName = (a: Channel, b: Channel) =>
    channelLabel(state, a).localeCompare(channelLabel(state, b));

  return {
    public: mine.filter((c) => c.type === 'public').sort(byName),
    private: mine.filter((c) => c.type === 'private').sort(byName),
    dms: mine
      .filter((c) => c.type === 'dm')
      .sort((a, b) => lastActivityAt(state, b).localeCompare(lastActivityAt(state, a))),
  };
}

/** People in the workspace the viewer could start a DM with. */
export function dmCandidates(state: PersistedState, workspaceId: string): User[] {
  const memberIds = new Set<string>();
  for (const c of state.channels) {
    if (c.workspaceId !== workspaceId) continue;
    for (const id of c.memberIds) memberIds.add(id);
  }
  memberIds.delete(state.currentUserId);
  return state.users.filter((u) => memberIds.has(u.id));
}
