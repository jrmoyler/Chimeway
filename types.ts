/**
 * Core domain types.
 *
 * Two deliberate changes from the original model:
 *
 * 1. Messages are stored FLAT with a `parentId`, rather than root messages
 *    owning a nested `thread: Message[]`. The nested shape was why replies
 *    could not be edited, deleted or reacted to - every mutation walked
 *    `channel.messages` and never descended. Flat storage makes every
 *    operation uniform for root messages and replies alike.
 *
 * 2. `Reaction` no longer carries a denormalised `count`. The count is
 *    `users.length`; storing both allowed them to drift apart.
 */

export type UserStatus = 'active' | 'idle' | 'dnd' | 'away' | 'offline';

export interface User {
  id: string;
  name: string;
  displayName: string;
  title: string;
  avatar: string;
  status: UserStatus;
}

export interface Reaction {
  emoji: string;
  /** User ids who reacted. The displayed count is this array's length. */
  userIds: string[];
}

export interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  /** Bytes. Used for display and for the upload size limit. */
  size: number;
  /** Object key in the `attachments` bucket, used to mint a signed URL. */
  storagePath: string;
}

export interface Message {
  id: string;
  channelId: string;
  /** null for a top-level message; the root message id for a thread reply. */
  parentId: string | null;
  userId: string;
  text: string;
  /** ISO 8601. Sortable and groupable, unlike the previous display strings. */
  createdAt: string;
  /** ISO 8601 when the message was last edited, else null. */
  editedAt: string | null;
  reactions: Reaction[];
  attachments: Attachment[];
}

export type ChannelType = 'public' | 'private' | 'dm';

export interface Channel {
  id: string;
  workspaceId: string;
  type: ChannelType;
  /**
   * For public/private channels this is the channel name. For DMs it is
   * ignored at render time - the label is derived from the members, so it
   * stays correct when someone is renamed.
   */
  name: string;
  description: string;
  /** Real membership for every channel type, not just DMs. */
  memberIds: string[];
  createdAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  /** Two-letter monogram shown in the workspace rail. */
  initials: string;
  /** Tailwind-independent hex used as the rail tile background. */
  color: string;
}

export interface NotificationPrefs {
  allMessages: boolean;
  mentionsAndDms: boolean;
  soundEnabled: boolean;
}

export type ThemePreference = 'light' | 'dark' | 'system';

export interface PersistedState {
  schemaVersion: number;
  users: User[];
  workspaces: Workspace[];
  channels: Channel[];
  messages: Message[];
  /** channelId -> ISO timestamp the viewer last read that channel. */
  lastReadAt: Record<string, string>;
  currentUserId: string;
  notificationPrefs: NotificationPrefs;
}
