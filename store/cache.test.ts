import { describe, expect, it } from 'vitest';
import type { MessageRow } from '../database.types';
import type { Message } from '../types';
import {
  applyAttachmentInsert,
  applyMessageDelete,
  applyMessageInsert,
  applyMessageUpdate,
  applyReaction,
  upsertUser,
} from './cache';

/**
 * Realtime patching runs on every event the server sends. These cover the
 * cases that are easy to get wrong and invisible when wrong: duplicate echoes,
 * events for channels that are not loaded, and reaction toggles arriving twice.
 */

const row = (over: Partial<MessageRow> = {}): MessageRow => ({
  id: 'm1',
  channel_id: 'c1',
  parent_id: null,
  user_id: 'u1',
  body: 'hello',
  created_at: '2026-01-01T00:00:00.000Z',
  edited_at: null,
  ...over,
});

const msg = (over: Partial<Message> = {}): Message => ({
  id: 'm1',
  channelId: 'c1',
  parentId: null,
  userId: 'u1',
  text: 'hello',
  createdAt: '2026-01-01T00:00:00.000Z',
  editedAt: null,
  reactions: [],
  attachments: [],
  ...over,
});

const loaded = () => true;
const notLoaded = () => false;

describe('message inserts', () => {
  it('adds a new message', () => {
    expect(applyMessageInsert([], row(), loaded)).toHaveLength(1);
  });

  // The sender adds their own message optimistically, then the server echoes
  // it back. Without this the message appears twice.
  it('ignores a duplicate echo of a message already present', () => {
    const existing = [msg()];
    expect(applyMessageInsert(existing, row(), loaded)).toBe(existing);
  });

  // Otherwise a busy channel the user has never opened accumulates a partial,
  // gap-ridden history in memory that looks complete when they open it.
  it('ignores messages for channels that have not been loaded', () => {
    const existing: Message[] = [];
    expect(applyMessageInsert(existing, row({ id: 'm2' }), notLoaded)).toBe(existing);
  });
});

describe('message updates', () => {
  it('applies an edit and keeps reactions and attachments', () => {
    const existing = [
      msg({
        reactions: [{ emoji: '👍', userIds: ['u2'] }],
        attachments: [
          { id: 'a1', name: 'f.png', mimeType: 'image/png', size: 1, storagePath: 'c1/f.png' },
        ],
      }),
    ];
    const next = applyMessageUpdate(existing, row({ body: 'edited', edited_at: 'later' }));
    expect(next[0]?.text).toBe('edited');
    expect(next[0]?.editedAt).toBe('later');
    expect(next[0]?.reactions).toHaveLength(1);
    expect(next[0]?.attachments).toHaveLength(1);
  });

  it('returns the same array when the message is not cached', () => {
    const existing = [msg()];
    expect(applyMessageUpdate(existing, row({ id: 'other' }))).toBe(existing);
  });
});

describe('message deletes', () => {
  it('removes the message and its replies, matching the database cascade', () => {
    const existing = [
      msg({ id: 'root' }),
      msg({ id: 'r1', parentId: 'root' }),
      msg({ id: 'r2', parentId: 'root' }),
      msg({ id: 'unrelated' }),
    ];
    const next = applyMessageDelete(existing, 'root');
    expect(next.map((m) => m.id)).toEqual(['unrelated']);
  });

  it('returns the same array when nothing matched', () => {
    const existing = [msg()];
    expect(applyMessageDelete(existing, 'missing')).toBe(existing);
  });
});

describe('reactions', () => {
  it('adds a reaction to a message with none', () => {
    const next = applyReaction([msg()], { message_id: 'm1', user_id: 'u2', emoji: '🎉' }, true);
    expect(next[0]?.reactions).toEqual([{ emoji: '🎉', userIds: ['u2'] }]);
  });

  it('is idempotent when the same add arrives twice', () => {
    const once = applyReaction([msg()], { message_id: 'm1', user_id: 'u2', emoji: '🎉' }, true);
    const twice = applyReaction(once, { message_id: 'm1', user_id: 'u2', emoji: '🎉' }, true);
    expect(twice[0]?.reactions[0]?.userIds).toEqual(['u2']);
  });

  it('is idempotent when the same removal arrives twice', () => {
    const start = [msg({ reactions: [{ emoji: '🎉', userIds: ['u2'] }] })];
    const once = applyReaction(start, { message_id: 'm1', user_id: 'u2', emoji: '🎉' }, false);
    const twice = applyReaction(once, { message_id: 'm1', user_id: 'u2', emoji: '🎉' }, false);
    expect(twice[0]?.reactions).toEqual([]);
  });

  it('keeps other reactors when one person withdraws', () => {
    const start = [msg({ reactions: [{ emoji: '🎉', userIds: ['u2', 'u3'] }] })];
    const next = applyReaction(start, { message_id: 'm1', user_id: 'u2', emoji: '🎉' }, false);
    expect(next[0]?.reactions).toEqual([{ emoji: '🎉', userIds: ['u3'] }]);
  });

  it('drops the emoji entirely when the last reactor withdraws', () => {
    const start = [msg({ reactions: [{ emoji: '🎉', userIds: ['u2'] }] })];
    const next = applyReaction(start, { message_id: 'm1', user_id: 'u2', emoji: '🎉' }, false);
    expect(next[0]?.reactions).toEqual([]);
  });
});

describe('attachments', () => {
  const attachmentRow = {
    id: 'a1',
    message_id: 'm1',
    storage_path: 'c1/a1-file.png',
    name: 'file.png',
    mime_type: 'image/png',
    size_bytes: 42,
    created_at: '2026-01-01T00:00:00.000Z',
  };

  it('attaches a file to its message', () => {
    const next = applyAttachmentInsert([msg()], attachmentRow);
    expect(next[0]?.attachments).toHaveLength(1);
    expect(next[0]?.attachments[0]?.storagePath).toBe('c1/a1-file.png');
  });

  it('ignores a duplicate attachment event', () => {
    const once = applyAttachmentInsert([msg()], attachmentRow);
    const twice = applyAttachmentInsert(once, attachmentRow);
    expect(twice[0]?.attachments).toHaveLength(1);
  });

  // Regression: the sender renders attachments before their rows exist, so
  // those placeholders have no real id. Deduplicating by id let the realtime
  // echo append a second copy of every attachment.
  it('replaces an optimistic placeholder rather than duplicating it', () => {
    const optimistic = [
      msg({
        attachments: [
          {
            id: 'pending-0',
            name: 'file.png',
            mimeType: 'image/png',
            size: 42,
            storagePath: 'c1/a1-file.png',
          },
        ],
      }),
    ];

    const next = applyAttachmentInsert(optimistic, attachmentRow);
    expect(next[0]?.attachments).toHaveLength(1);
    expect(next[0]?.attachments[0]?.id).toBe('a1');
  });
});

describe('profiles', () => {
  const profileRow = {
    id: 'u9',
    full_name: 'New Person',
    display_name: 'newp',
    title: '',
    avatar_url: null,
    status: 'active' as const,
    last_seen_at: '',
    created_at: '',
    updated_at: '',
  };

  it('inserts an unknown profile', () => {
    expect(upsertUser([], profileRow)).toHaveLength(1);
  });

  it('replaces an existing profile rather than duplicating it', () => {
    const once = upsertUser([], profileRow);
    const renamed = upsertUser(once, { ...profileRow, full_name: 'Renamed' });
    expect(renamed).toHaveLength(1);
    expect(renamed[0]?.name).toBe('Renamed');
  });
});
