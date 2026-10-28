import type {
  AttachmentRow,
  ChannelRow,
  MessageReactionRow,
  MessageRow,
  ProfileRow,
  WorkspaceRow,
} from '../database.types';
import type { Attachment, Channel, Message, Reaction, User, Workspace } from '../types';

/**
 * Database rows -> domain objects.
 *
 * Kept in one place so snake_case never leaks past this boundary, and so a
 * schema rename surfaces as a compile error in a single file rather than as
 * `undefined` scattered through components.
 */

export function toUser(row: ProfileRow): User {
  return {
    id: row.id,
    name: row.full_name || row.display_name,
    displayName: row.display_name,
    title: row.title,
    avatar: row.avatar_url ?? '',
    status: row.status,
  };
}

export function toWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    initials: row.initials,
    color: row.color,
  };
}

export function toChannel(row: ChannelRow, memberIds: string[]): Channel {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    type: row.type,
    name: row.name,
    description: row.description,
    memberIds,
    createdAt: row.created_at,
  };
}

export function toAttachment(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    name: row.name,
    mimeType: row.mime_type,
    size: Number(row.size_bytes),
    storagePath: row.storage_path,
  };
}

/**
 * Reaction rows are grouped into one entry per emoji. The count is the length
 * of `userIds`, never a stored number, so it cannot drift.
 */
function toReactions(rows: MessageReactionRow[]): Reaction[] {
  const byEmoji = new Map<string, string[]>();
  for (const row of rows) {
    const users = byEmoji.get(row.emoji);
    if (users) users.push(row.user_id);
    else byEmoji.set(row.emoji, [row.user_id]);
  }
  return [...byEmoji.entries()].map(([emoji, userIds]) => ({ emoji, userIds }));
}

export function toMessage(
  row: MessageRow,
  reactions: MessageReactionRow[] = [],
  attachments: AttachmentRow[] = [],
): Message {
  return {
    id: row.id,
    channelId: row.channel_id,
    parentId: row.parent_id,
    userId: row.user_id,
    text: row.body,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    reactions: toReactions(reactions),
    attachments: attachments.map(toAttachment),
  };
}
