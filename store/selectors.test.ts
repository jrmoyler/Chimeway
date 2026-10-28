import { describe, expect, it } from 'vitest';
import type { PersistedState } from '../types';
import {
  channelLabel,
  channelMembers,
  dmCandidates,
  replyCountsByRoot,
  rootMessages,
  threadReplies,
  usersById,
  visibleChannels,
} from './selectors';

/**
 * Selectors operate on the client cache that the Supabase store fills.
 *
 * The fixture is built here rather than imported from a seed file so these
 * tests describe the shapes the selectors must handle, independently of
 * whatever sample data the server happens to ship.
 */

const ME = 'u-me';

function makeState(overrides: Partial<PersistedState> = {}): PersistedState {
  return {
    schemaVersion: 2,
    currentUserId: ME,
    notificationPrefs: { allMessages: false, mentionsAndDms: true, soundEnabled: false },
    lastReadAt: {},
    users: [
      { id: ME, name: 'Me Myself', displayName: 'me', title: '', avatar: '', status: 'active' },
      { id: 'u-bob', name: 'Bob Okafor', displayName: 'bob', title: '', avatar: '', status: 'active' },
      { id: 'u-cat', name: 'Cat Diaz', displayName: 'cat', title: '', avatar: '', status: 'idle' },
      { id: 'u-dee', name: 'Dee Patel', displayName: 'dee', title: '', avatar: '', status: 'dnd' },
    ],
    workspaces: [{ id: 'w1', name: 'Acme', initials: 'AC', color: '#1264a3' }],
    channels: [
      {
        id: 'c-general',
        workspaceId: 'w1',
        type: 'public',
        name: 'general',
        description: '',
        memberIds: [ME, 'u-bob'],
        createdAt: '2026-01-01T09:00:00.000Z',
      },
      {
        id: 'c-secret',
        workspaceId: 'w1',
        type: 'private',
        name: 'secret',
        description: '',
        memberIds: ['u-bob', 'u-cat'],
        createdAt: '2026-01-01T09:00:00.000Z',
      },
      {
        id: 'c-dm-bob',
        workspaceId: 'w1',
        type: 'dm',
        name: '',
        description: '',
        memberIds: [ME, 'u-bob'],
        createdAt: '2026-01-02T09:00:00.000Z',
      },
      {
        id: 'c-dm-group',
        workspaceId: 'w1',
        type: 'dm',
        name: '',
        description: '',
        memberIds: [ME, 'u-cat', 'u-dee'],
        createdAt: '2026-01-03T09:00:00.000Z',
      },
    ],
    messages: [
      msg('m1', 'c-general', null, ME, 'first', '2026-01-04T10:00:00.000Z'),
      msg('m2', 'c-general', null, 'u-bob', 'second', '2026-01-04T10:05:00.000Z'),
      msg('m2r1', 'c-general', 'm2', ME, 'reply one', '2026-01-04T10:06:00.000Z'),
      msg('m2r2', 'c-general', 'm2', 'u-bob', 'reply two', '2026-01-04T10:07:00.000Z'),
      msg('x1', 'c-secret', null, 'u-bob', 'not mine', '2026-01-04T11:00:00.000Z'),
    ],
    ...overrides,
  };
}

function msg(
  id: string,
  channelId: string,
  parentId: string | null,
  userId: string,
  text: string,
  createdAt: string,
) {
  return {
    id,
    channelId,
    parentId,
    userId,
    text,
    createdAt,
    editedAt: null,
    reactions: [],
    attachments: [],
  };
}

describe('channel labels', () => {
  it('uses the channel name for non-DMs', () => {
    const state = makeState();
    expect(channelLabel(state, state.channels[0]!)).toBe('general');
  });

  // Regression: DM names used to be frozen strings that went stale on rename.
  it('derives a 1:1 DM label from the other person', () => {
    const state = makeState();
    const dm = state.channels.find((c) => c.id === 'c-dm-bob')!;
    expect(channelLabel(state, dm)).toBe('Bob Okafor');

    const renamed = makeState({
      users: state.users.map((u) => (u.id === 'u-bob' ? { ...u, name: 'Robert Okafor' } : u)),
    });
    expect(channelLabel(renamed, dm)).toBe('Robert Okafor');
  });

  it('lists both people in a small group DM', () => {
    const state = makeState();
    const group = state.channels.find((c) => c.id === 'c-dm-group')!;
    expect(channelLabel(state, group)).toBe('Cat Diaz, Dee Patel');
  });

  it('summarises a large group DM', () => {
    const state = makeState();
    const big = {
      ...state.channels[3]!,
      memberIds: [ME, 'u-bob', 'u-cat', 'u-dee'],
    };
    expect(channelLabel(state, big)).toBe('Bob Okafor and 2 others');
  });
});

describe('visibility', () => {
  it('lists only channels the viewer belongs to', () => {
    const groups = visibleChannels(makeState(), 'w1');
    expect(groups.public.map((c) => c.name)).toEqual(['general']);
    expect(groups.private).toEqual([]);
    expect(groups.dms).toHaveLength(2);
  });

  it('orders DMs by most recent activity', () => {
    const groups = visibleChannels(makeState(), 'w1');
    // c-dm-group was created later and has no messages, so it sorts first.
    expect(groups.dms[0]?.id).toBe('c-dm-group');
  });

  it('excludes the viewer from DM candidates', () => {
    expect(dmCandidates(makeState(), 'w1').map((u) => u.id)).not.toContain(ME);
  });

  it('reports real channel membership', () => {
    const state = makeState();
    const members = channelMembers(state, state.channels[0]!);
    expect(members.map((u) => u.id)).toEqual([ME, 'u-bob']);
  });
});

describe('threading', () => {
  it('returns only root messages, oldest first', () => {
    const roots = rootMessages(makeState(), 'c-general');
    expect(roots.map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('returns a thread\'s replies oldest first', () => {
    expect(threadReplies(makeState(), 'm2').map((m) => m.id)).toEqual(['m2r1', 'm2r2']);
  });

  // Regression: counting replies per rendered row was O(n^2).
  it('counts replies for every root in one pass', () => {
    const counts = replyCountsByRoot(makeState());
    expect(counts.get('m2')).toBe(2);
    expect(counts.get('m1')).toBeUndefined();
  });
});

describe('lookups', () => {
  it('indexes users by id', () => {
    const map = usersById(makeState());
    expect(map.get('u-bob')?.name).toBe('Bob Okafor');
    expect(map.size).toBe(4);
  });
});
