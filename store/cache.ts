import type { AttachmentRow, MessageReactionRow, MessageRow, ProfileRow } from '../database.types';
import type { Message, User } from '../types';
import { toAttachment, toMessage, toUser } from '../data/mappers';

/**
 * Pure cache transformations for realtime events.
 *
 * Extracted from the provider so the patching rules can be tested directly.
 * These run on every event from the server, and a mistake here shows up as a
 * duplicated message or a reaction count that drifts - the kind of fault that
 * is easy to ship and hard to notice.
 */

/**
 * Inserts a message, ignoring duplicates and events for channels that have not
 * been loaded.
 *
 * Duplicates are real: a message the user just sent is added optimistically
 * and then arrives again as a realtime echo.
 */
export function applyMessageInsert(
  messages: Message[],
  row: MessageRow,
  isChannelLoaded: (channelId: string) => boolean,
): Message[] {
  if (!isChannelLoaded(row.channel_id)) return messages;
  if (messages.some((m) => m.id === row.id)) return messages;
  return [...messages, toMessage(row)];
}

/** Applies an edit, preserving reactions and attachments already in the cache. */
export function applyMessageUpdate(messages: Message[], row: MessageRow): Message[] {
  let changed = false;
  const next = messages.map((m) => {
    if (m.id !== row.id) return m;
    changed = true;
    return { ...m, text: row.body, editedAt: row.edited_at, parentId: row.parent_id };
  });
  return changed ? next : messages;
}

/** Removes a message and any replies to it, matching the database cascade. */
export function applyMessageDelete(messages: Message[], messageId: string): Message[] {
  const next = messages.filter((m) => m.id !== messageId && m.parentId !== messageId);
  return next.length === messages.length ? messages : next;
}

/**
 * Adds or removes one person's reaction.
 *
 * Idempotent in both directions, because an optimistic update and its echo
 * describe the same change.
 */
export function applyReaction(
  messages: Message[],
  row: Pick<MessageReactionRow, 'message_id' | 'user_id' | 'emoji'>,
  added: boolean,
): Message[] {
  return messages.map((m) => {
    if (m.id !== row.message_id) return m;

    const existing = m.reactions.find((r) => r.emoji === row.emoji);

    if (added) {
      if (existing?.userIds.includes(row.user_id)) return m;
      const reactions = existing
        ? m.reactions.map((r) =>
            r.emoji === row.emoji ? { ...r, userIds: [...r.userIds, row.user_id] } : r,
          )
        : [...m.reactions, { emoji: row.emoji, userIds: [row.user_id] }];
      return { ...m, reactions };
    }

    if (!existing?.userIds.includes(row.user_id)) return m;

    const userIds = existing.userIds.filter((id) => id !== row.user_id);
    return {
      ...m,
      reactions:
        userIds.length === 0
          ? m.reactions.filter((r) => r.emoji !== row.emoji)
          : m.reactions.map((r) => (r.emoji === row.emoji ? { ...r, userIds } : r)),
    };
  });
}

/**
 * Attaches a file to its message.
 *
 * Matched on `storagePath`, not `id`. The sender renders its attachments
 * optimistically before the rows exist, so those placeholders carry no real
 * id; deduplicating by id would fail to match and show every attachment
 * twice. The storage path is unique (enforced by the schema) and is the one
 * value both sides already know.
 */
export function applyAttachmentInsert(messages: Message[], row: AttachmentRow): Message[] {
  const incoming = toAttachment(row);

  return messages.map((m) => {
    if (m.id !== row.message_id) return m;

    const existing = m.attachments.findIndex((a) => a.storagePath === incoming.storagePath);

    // Replace the optimistic placeholder so the real id takes over.
    if (existing >= 0) {
      const attachments = [...m.attachments];
      attachments[existing] = incoming;
      return { ...m, attachments };
    }

    return { ...m, attachments: [...m.attachments, incoming] };
  });
}

/** Inserts or replaces a profile. */
export function upsertUser(users: User[], row: ProfileRow): User[] {
  const user = toUser(row);
  return users.some((u) => u.id === user.id)
    ? users.map((u) => (u.id === user.id ? user : u))
    : [...users, user];
}
