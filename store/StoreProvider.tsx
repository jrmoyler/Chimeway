import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type {
  AttachmentRow,
  ChannelMemberRow,
  MessageReactionRow,
  MessageRow,
  ProfileRow,
} from '../database.types';
import type {
  Channel,
  Message,
  NotificationPrefs,
  PersistedState,
  User,
  UserStatus,
} from '../types';
import { getSupabase, isSupabaseConfigured } from '../lib/supabase';
import * as api from '../data/api';
import { useSession } from './SessionProvider';
import * as cache from './cache';

/**
 * Workspace data, backed by Supabase.
 *
 * The in-memory shape intentionally matches the old local `PersistedState`, so
 * every selector in store/selectors.ts - and its tests - continues to work
 * unchanged against server data. Only the write path changed: dispatching into
 * a reducer became awaiting the API, with realtime events folding results back
 * into the same cache.
 */

const NOTIFICATION_PREFS_KEY = 'chimeway:notifications';

const EMPTY_STATE: PersistedState = {
  schemaVersion: 2,
  users: [],
  workspaces: [],
  channels: [],
  messages: [],
  lastReadAt: {},
  currentUserId: '',
  notificationPrefs: { allMessages: false, mentionsAndDms: true, soundEnabled: false },
};

function readPrefs(): NotificationPrefs {
  try {
    const raw = localStorage.getItem(NOTIFICATION_PREFS_KEY);
    if (!raw) return EMPTY_STATE.notificationPrefs;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return EMPTY_STATE.notificationPrefs;
    const p = parsed as Partial<NotificationPrefs>;
    return {
      allMessages: Boolean(p.allMessages),
      mentionsAndDms: p.mentionsAndDms !== false,
      soundEnabled: Boolean(p.soundEnabled),
    };
  } catch {
    return EMPTY_STATE.notificationPrefs;
  }
}

export interface UnreadSummary {
  count: number;
  hasMention: boolean;
}

export interface StoreActions {
  sendMessage(input: {
    channelId: string;
    parentId: string | null;
    text: string;
    files?: File[];
  }): Promise<void>;
  editMessage(messageId: string, text: string): Promise<void>;
  deleteMessage(messageId: string): Promise<void>;
  toggleReaction(messageId: string, emoji: string): Promise<void>;
  markChannelRead(channelId: string): Promise<void>;
  createChannel(
    workspaceId: string,
    name: string,
    type: 'public' | 'private',
    description: string,
  ): Promise<string | null>;
  createWorkspace(name: string): Promise<string | null>;
  createDm(workspaceId: string, userIds: string[]): Promise<string | null>;
  joinChannel(channelId: string): Promise<void>;
  setStatus(status: UserStatus): Promise<void>;
  updateProfile(patch: {
    name?: string;
    displayName?: string;
    title?: string;
    avatar?: string;
  }): Promise<void>;
  setNotificationPrefs(prefs: NotificationPrefs): void;
}

interface StoreContextValue {
  state: PersistedState;
  actions: StoreActions;
  ready: boolean;
  error: string | null;
  /** Unread summary per channel, from the server. */
  unread: Record<string, UnreadSummary>;
  /** Loads a channel's messages into the cache. Idempotent. */
  openChannel(channelId: string): Promise<void>;
  /** True while a channel's first page is being fetched. */
  loadingChannel: string | null;
  refresh(): Promise<void>;
  dismissError(): void;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export const StoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { userId, ready: sessionReady } = useSession();

  const [state, setState] = useState<PersistedState>(() => ({
    ...EMPTY_STATE,
    notificationPrefs: readPrefs(),
  }));
  const [unread, setUnread] = useState<Record<string, UnreadSummary>>({});
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingChannel, setLoadingChannel] = useState<string | null>(null);

  const loadedChannels = useRef<Set<string>>(new Set());
  const realtimeRef = useRef<RealtimeChannel | null>(null);

  const report = useCallback((err: unknown, fallback: string) => {
    const message = err instanceof Error ? err.message : fallback;
    setError(message);
    console.error(fallback, err);
  }, []);

  // -------------------------------------------------------------------------
  // Initial load
  // -------------------------------------------------------------------------

  interface Snapshot {
    users: User[];
    workspaces: PersistedState['workspaces'];
    channels: Channel[];
    lastReadAt: Record<string, string>;
  }

  /** Reads everything this user can see. Pure: it stores nothing itself. */
  const fetchSnapshot = useCallback(async (): Promise<Snapshot> => {
    const [profiles, workspaces] = await Promise.all([
      api.fetchProfiles(),
      api.fetchWorkspaces(),
    ]);

    if (workspaces.length === 0) {
      return { users: profiles, workspaces, channels: [], lastReadAt: {} };
    }

    const bundles = await Promise.all(workspaces.map((w) => api.fetchChannels(w.id)));

    return {
      users: profiles,
      workspaces,
      channels: bundles.flatMap((b) => b.channels),
      lastReadAt: Object.assign({}, ...bundles.map((b) => b.lastReadAt)) as Record<string, string>,
    };
  }, []);

  const applySnapshot = useCallback(
    (snapshot: Snapshot, uid: string) => {
      setState((current) => ({
        ...current,
        users: snapshot.users,
        workspaces: snapshot.workspaces,
        channels: snapshot.channels,
        lastReadAt: snapshot.lastReadAt,
        currentUserId: uid,
      }));
    },
    [],
  );

  /** Re-reads everything. Used after membership changes. */
  const loadAll = useCallback(async () => {
    if (!userId) return;
    try {
      applySnapshot(await fetchSnapshot(), userId);
    } catch (err) {
      report(err, 'Could not load your workspaces');
    }
  }, [userId, fetchSnapshot, applySnapshot, report]);

  // This provider is mounted only while a session exists (see index.tsx), so
  // signing out unmounts it and discards the cache - there is no reset branch
  // to keep correct.
  useEffect(() => {
    if (!sessionReady || !userId) return;

    let cancelled = false;
    void (async () => {
      try {
        const snapshot = await fetchSnapshot();
        if (!cancelled) applySnapshot(snapshot, userId);
      } catch (err) {
        if (!cancelled) report(err, 'Could not load your workspaces');
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionReady, userId, fetchSnapshot, applySnapshot, report]);

  // -------------------------------------------------------------------------
  // Unread counts
  // -------------------------------------------------------------------------

  const workspaceIds = useMemo(
    () => state.workspaces.map((w) => w.id).join(','),
    [state.workspaces],
  );

  /** Fetches counts without touching state, so callers decide when to store. */
  const fetchUnread = useCallback(async (): Promise<Record<string, UnreadSummary> | null> => {
    if (!userId || !workspaceIds) return null;
    try {
      const results = await Promise.all(
        workspaceIds.split(',').map(async (id) => api.fetchUnreadCounts(id)),
      );
      const next: Record<string, UnreadSummary> = {};
      for (const rows of results) {
        for (const row of rows) {
          next[row.channel_id] = {
            count: Number(row.unread_count),
            hasMention: Boolean(row.has_mention),
          };
        }
      }
      return next;
    } catch (err) {
      // Non-fatal: badges are a convenience, not a blocker.
      console.warn('Could not refresh unread counts', err);
      return null;
    }
  }, [userId, workspaceIds]);

  const refreshUnread = useCallback(async () => {
    const next = await fetchUnread();
    if (next) setUnread(next);
  }, [fetchUnread]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void (async () => {
      const next = await fetchUnread();
      if (!cancelled && next) setUnread(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, fetchUnread]);

  // -------------------------------------------------------------------------
  // Channel message loading
  // -------------------------------------------------------------------------

  const openChannel = useCallback(
    async (channelId: string) => {
      if (!channelId || loadedChannels.current.has(channelId)) return;
      loadedChannels.current.add(channelId);
      setLoadingChannel(channelId);

      try {
        const messages = await api.fetchMessages(channelId);
        setState((current) => ({
          ...current,
          messages: [
            ...current.messages.filter((m) => m.channelId !== channelId),
            ...messages,
          ],
        }));
      } catch (err) {
        loadedChannels.current.delete(channelId);
        report(err, 'Could not load this conversation');
      } finally {
        setLoadingChannel((c) => (c === channelId ? null : c));
      }
    },
    [report],
  );

  // -------------------------------------------------------------------------
  // Realtime
  //
  // Subscriptions carry no channel filter on purpose: RLS already limits the
  // stream to rows this user may read, so filtering client-side would only
  // duplicate a rule the database already enforces - and get it wrong when a
  // user is added to a channel mid-session.
  // -------------------------------------------------------------------------

  // Thin wrappers over the pure helpers in store/cache.ts, which is where the
  // patching rules are defined and tested.
  const applyMessageInsert = useCallback((row: MessageRow) => {
    setState((current) => {
      const messages = cache.applyMessageInsert(current.messages, row, (id) =>
        loadedChannels.current.has(id),
      );
      return messages === current.messages ? current : { ...current, messages };
    });
  }, []);

  const applyMessageUpdate = useCallback((row: MessageRow) => {
    setState((current) => {
      const messages = cache.applyMessageUpdate(current.messages, row);
      return messages === current.messages ? current : { ...current, messages };
    });
  }, []);

  const applyMessageDelete = useCallback((row: { id?: string }) => {
    if (!row.id) return;
    const id = row.id;
    setState((current) => {
      const messages = cache.applyMessageDelete(current.messages, id);
      return messages === current.messages ? current : { ...current, messages };
    });
  }, []);

  const applyReaction = useCallback((row: MessageReactionRow, added: boolean) => {
    setState((current) => ({
      ...current,
      messages: cache.applyReaction(current.messages, row, added),
    }));
  }, []);

  useEffect(() => {
    // Local mode has one person in one tab, and every action already updates
    // the cache optimistically, so there is no stream to subscribe to.
    if (!userId || !ready || !isSupabaseConfigured) return;

    const supabase = getSupabase();
    const channel = supabase
      .channel('chimeway-stream')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages' },
        (payload) => {
          if (payload.eventType === 'INSERT') applyMessageInsert(payload.new as MessageRow);
          else if (payload.eventType === 'UPDATE') applyMessageUpdate(payload.new as MessageRow);
          else if (payload.eventType === 'DELETE') applyMessageDelete(payload.old as { id?: string });
          void refreshUnread();
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'message_reactions' },
        (payload) => applyReaction(payload.new as MessageReactionRow, true),
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'message_reactions' },
        (payload) => applyReaction(payload.old as MessageReactionRow, false),
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'attachments' },
        (payload) => {
          const row = payload.new as AttachmentRow;
          setState((current) => ({
            ...current,
            messages: cache.applyAttachmentInsert(current.messages, row),
          }));
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles' },
        (payload) => {
          if (payload.eventType === 'DELETE') return;
          const row = payload.new as ProfileRow;
          setState((current) => ({ ...current, users: cache.upsertUser(current.users, row) }));
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'channel_members' },
        (payload) => {
          const row = (payload.new ?? payload.old) as ChannelMemberRow | undefined;
          if (!row?.channel_id) return;

          // Membership changes alter what this user can see, so re-read rather
          // than trying to patch the cache from a partial payload.
          void loadAll();
        },
      )
      .subscribe();

    realtimeRef.current = channel;

    return () => {
      void supabase.removeChannel(channel);
      realtimeRef.current = null;
    };
  }, [
    userId,
    ready,
    applyMessageInsert,
    applyMessageUpdate,
    applyMessageDelete,
    applyReaction,
    refreshUnread,
    loadAll,
  ]);

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  const actions = useMemo<StoreActions>(
    () => ({
      async sendMessage({ channelId, parentId, text, files }) {
        if (!userId) return;
        try {
          const message = await api.sendMessage({
            channelId,
            parentId,
            userId,
            text,
            ...(files?.length ? { files } : {}),
          });
          // Insert immediately rather than waiting for the realtime echo, so
          // the composer feels instant. The echo is de-duplicated by id.
          setState((current) =>
            current.messages.some((m) => m.id === message.id)
              ? current
              : { ...current, messages: [...current.messages, message] },
          );
        } catch (err) {
          report(err, 'Could not send the message');
        }
      },

      async editMessage(messageId, text) {
        const previous = state.messages.find((m) => m.id === messageId);
        setState((current) => ({
          ...current,
          messages: current.messages.map((m) =>
            m.id === messageId ? { ...m, text, editedAt: new Date().toISOString() } : m,
          ),
        }));
        try {
          await api.editMessage(messageId, text);
        } catch (err) {
          // Roll back the optimistic edit.
          if (previous) {
            setState((current) => ({
              ...current,
              messages: current.messages.map((m) => (m.id === messageId ? previous : m)),
            }));
          }
          report(err, 'Could not save the edit');
        }
      },

      async deleteMessage(messageId) {
        const removed = state.messages.filter((m) => m.id === messageId || m.parentId === messageId);
        setState((current) => ({
          ...current,
          messages: current.messages.filter(
            (m) => m.id !== messageId && m.parentId !== messageId,
          ),
        }));
        try {
          await api.deleteMessage(messageId);
        } catch (err) {
          setState((current) => ({ ...current, messages: [...current.messages, ...removed] }));
          report(err, 'Could not delete the message');
        }
      },

      async toggleReaction(messageId, emoji) {
        if (!userId) return;
        // Optimistic: the realtime echo confirms it.
        applyReaction(
          { message_id: messageId, user_id: userId, emoji, created_at: '' },
          !state.messages
            .find((m) => m.id === messageId)
            ?.reactions.find((r) => r.emoji === emoji)
            ?.userIds.includes(userId),
        );
        try {
          await api.toggleReaction(messageId, emoji);
        } catch (err) {
          report(err, 'Could not update the reaction');
        }
      },

      async markChannelRead(channelId) {
        try {
          await api.markChannelRead(channelId);
          setState((current) => ({
            ...current,
            lastReadAt: { ...current.lastReadAt, [channelId]: new Date().toISOString() },
          }));
          setUnread((current) => ({ ...current, [channelId]: { count: 0, hasMention: false } }));
        } catch (err) {
          console.warn('Could not update read state', err);
        }
      },

      async createChannel(workspaceId, name, type, description) {
        try {
          const channel = await api.createChannel(workspaceId, name, type, description);
          setState((current) => ({ ...current, channels: [...current.channels, channel] }));
          loadedChannels.current.add(channel.id);
          return channel.id;
        } catch (err) {
          report(err, 'Could not create the channel');
          return null;
        }
      },

      async createWorkspace(name) {
        try {
          const workspace = await api.createWorkspace(name);
          await loadAll();
          return workspace.id;
        } catch (err) {
          report(err, 'Could not create the workspace');
          return null;
        }
      },

      async createDm(workspaceId, userIds) {
        try {
          const channel = await api.createDm(workspaceId, userIds);
          setState((current) =>
            current.channels.some((c) => c.id === channel.id)
              ? current
              : { ...current, channels: [...current.channels, channel] },
          );
          return channel.id;
        } catch (err) {
          report(err, 'Could not start the conversation');
          return null;
        }
      },

      async joinChannel(channelId) {
        if (!userId) return;
        try {
          await api.joinChannel(channelId, userId);
          await loadAll();
        } catch (err) {
          report(err, 'Could not join the channel');
        }
      },

      async setStatus(status) {
        if (!userId) return;
        setState((current) => ({
          ...current,
          users: current.users.map((u) => (u.id === userId ? { ...u, status } : u)),
        }));
        try {
          await api.setStatus(userId, status);
        } catch (err) {
          report(err, 'Could not update your status');
        }
      },

      async updateProfile(patch) {
        if (!userId) return;
        try {
          const updated = await api.updateProfile(userId, {
            ...(patch.name !== undefined ? { full_name: patch.name } : {}),
            ...(patch.displayName !== undefined ? { display_name: patch.displayName } : {}),
            ...(patch.title !== undefined ? { title: patch.title } : {}),
            ...(patch.avatar !== undefined ? { avatar_url: patch.avatar || null } : {}),
          });
          setState((current) => ({
            ...current,
            users: current.users.map((u) => (u.id === updated.id ? updated : u)),
          }));
        } catch (err) {
          report(err, 'Could not save your profile');
        }
      },

      setNotificationPrefs(prefs) {
        setState((current) => ({ ...current, notificationPrefs: prefs }));
        try {
          localStorage.setItem(NOTIFICATION_PREFS_KEY, JSON.stringify(prefs));
        } catch {
          // Preference is applied for this session even if it cannot persist.
        }
      },
    }),
    [userId, state.messages, applyReaction, report, loadAll],
  );

  const value = useMemo<StoreContextValue>(
    () => ({
      state,
      actions,
      ready,
      error,
      unread,
      openChannel,
      loadingChannel,
      refresh: loadAll,
      dismissError: () => setError(null),
    }),
    [state, actions, ready, error, unread, openChannel, loadingChannel, loadAll],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
};

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within a StoreProvider');
  return ctx;
}

/** Convenience for the many components that only need the current user. */
export function useCurrentUser(): User | undefined {
  const { state } = useStore();
  return state.users.find((u) => u.id === state.currentUserId);
}

export type { Message };
