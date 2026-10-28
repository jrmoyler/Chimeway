import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { Message, ThemePreference, UserStatus } from './types';
import { useStore } from './store/StoreProvider';
import {
  channelById,
  currentUser as selectCurrentUser,
  dmCandidates,
  visibleChannels,
  workspaceChannels,
} from './store/selectors';
import { applyResolvedTheme, getStoredTheme, persistTheme } from './lib/theme';
import { useMediaQuery } from './hooks/useMediaQuery';
import Sidebar from './components/Sidebar';
import ChatWindow from './components/ChatWindow';
import ThreadView from './components/ThreadView';
import Tutorial from './components/Tutorial';
import SettingsModal from './components/SettingsModal';
import AddWorkspaceModal from './components/AddWorkspaceModal';
import CreateChannelModal from './components/CreateChannelModal';
import NewDmModal from './components/NewDmModal';
import SearchModal from './components/SearchModal';
import MembersModal from './components/MembersModal';
import type { SettingsTab } from './components/UserProfileDropdown';

/** `#/w/<workspaceId>/c/<channelId>` so a refresh or shared link reopens here. */
function readRoute(): { workspaceId?: string; channelId?: string } {
  const match = /^#\/w\/([^/]+)(?:\/c\/([^/]+))?/.exec(window.location.hash);
  if (!match) return {};
  return { workspaceId: match[1], channelId: match[2] };
}

function writeRoute(workspaceId: string, channelId: string): void {
  const next = `#/w/${workspaceId}/c/${channelId}`;
  if (window.location.hash !== next) {
    window.history.replaceState(null, '', next);
  }
}

const App: React.FC = () => {
  const { state, actions, ready, error, unread, openChannel, dismissError } = useStore();

  const initialRoute = useMemo(() => readRoute(), []);
  /*
   * Selection is stored as the user's *intent* and resolved to something valid
   * during render. Validating with effects instead meant an extra render pass
   * showing a stale or empty selection first, and could loop if the fallback
   * itself was invalid.
   */
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(
    () => initialRoute.workspaceId ?? '',
  );
  const [selectedChannelId, setSelectedChannelId] = useState(() => initialRoute.channelId ?? '');
  const [threadRootId, setThreadRootId] = useState<string | null>(null);

  const activeWorkspaceId = useMemo(() => {
    if (state.workspaces.some((w) => w.id === selectedWorkspaceId)) return selectedWorkspaceId;
    return state.workspaces[0]?.id ?? '';
  }, [state.workspaces, selectedWorkspaceId]);

  const activeChannel = useMemo(() => {
    if (!activeWorkspaceId) return undefined;

    const selected = selectedChannelId ? channelById(state, selectedChannelId) : undefined;
    if (
      selected &&
      selected.workspaceId === activeWorkspaceId &&
      selected.memberIds.includes(state.currentUserId)
    ) {
      return selected;
    }

    const groups = visibleChannels(state, activeWorkspaceId);
    return groups.public[0] ?? groups.private[0] ?? groups.dms[0];
  }, [state, activeWorkspaceId, selectedChannelId]);

  const activeChannelId = activeChannel?.id ?? '';

  const [theme, setTheme] = useState<ThemePreference>(getStoredTheme);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('profile');
  const [workspaceModalOpen, setWorkspaceModalOpen] = useState(false);
  const [channelModalOpen, setChannelModalOpen] = useState(false);
  const [dmModalOpen, setDmModalOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const systemPrefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const me = selectCurrentUser(state);

  /* Derived rather than stored, so "system" stays reactive to the OS without
     syncing state from an effect. */
  const resolvedTheme: 'light' | 'dark' =
    theme === 'system' ? (systemPrefersDark ? 'dark' : 'light') : theme;

  // Sync the resolved appearance to the DOM and remember the preference.
  useEffect(() => {
    applyResolvedTheme(resolvedTheme);
    persistTheme(theme);
  }, [theme, resolvedTheme]);

  // Reflect the current location in the URL.
  useEffect(() => {
    if (activeWorkspaceId && activeChannelId) writeRoute(activeWorkspaceId, activeChannelId);
  }, [activeWorkspaceId, activeChannelId]);

  // Opening a channel loads its messages and marks it read. Clearing the open
  // thread is handled in the selection callbacks so no state is written here.
  useEffect(() => {
    if (!activeChannelId) return;
    void openChannel(activeChannelId).then(() => actions.markChannelRead(activeChannelId));
  }, [activeChannelId, openChannel, actions]);

  // Cmd/Ctrl+K opens search, the convention people expect.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const selectChannel = useCallback((channelId: string) => {
    setSelectedChannelId(channelId);
    setThreadRootId(null);
    setMobileNavOpen(false);
  }, []);

  const selectWorkspace = useCallback(
    (workspaceId: string) => {
      setSelectedWorkspaceId(workspaceId);
      const groups = visibleChannels(state, workspaceId);
      const first = groups.public[0] ?? groups.private[0] ?? groups.dms[0];
      setSelectedChannelId(first?.id ?? '');
      setThreadRootId(null);
      setMobileNavOpen(false);
    },
    [state],
  );

  const openSettings = useCallback((tab: SettingsTab) => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  }, []);

  /* If the root message is deleted while its panel is open, this resolves to
     undefined and the panel simply stops rendering. */
  const threadRoot: Message | undefined = threadRootId
    ? state.messages.find((m) => m.id === threadRootId)
    : undefined;

  if (!ready || !me) {
    return (
      <div className="flex h-dvh items-center justify-center bg-base" role="status" aria-live="polite">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-accent" />
        <span className="sr-only">Loading your workspace</span>
      </div>
    );
  }

  const existingChannelNames = workspaceChannels(state, activeWorkspaceId)
    .filter((c) => c.type !== 'dm')
    .map((c) => c.name);

  return (
    <div className="flex h-dvh overflow-hidden bg-base text-ink">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Skip to conversation
      </a>
      {/* Sidebar: a fixed column on desktop, a dismissible drawer on mobile.
          The original had no breakpoints at all - 720px of fixed-width shell
          before the message area got a single pixel. */}
      {isDesktop ? (
        <Sidebar
          unread={unread}
          workspaces={state.workspaces}
          activeWorkspaceId={activeWorkspaceId}
          activeChannelId={activeChannelId}
          onSelectWorkspace={selectWorkspace}
          onSelectChannel={selectChannel}
          onAddWorkspace={() => setWorkspaceModalOpen(true)}
          onCreateChannel={() => setChannelModalOpen(true)}
          onNewDm={() => setDmModalOpen(true)}
          onOpenSettings={openSettings}
          onShowTutorial={() => setTutorialOpen(true)}
          onOpenSearch={() => setSearchOpen(true)}
          onSetStatus={(status: UserStatus) => {
            void actions.setStatus(status);
          }}
          currentUser={me}
          theme={theme}
          resolvedTheme={resolvedTheme}
          onChangeTheme={setTheme}
        />
      ) : (
        mobileNavOpen && (
          <div className="fixed inset-0 z-40 flex">
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => setMobileNavOpen(false)}
              aria-hidden="true"
            />
            <div className="relative h-full">
              <Sidebar
                unread={unread}
                workspaces={state.workspaces}
                activeWorkspaceId={activeWorkspaceId}
                activeChannelId={activeChannelId}
                onSelectWorkspace={selectWorkspace}
                onSelectChannel={selectChannel}
                onAddWorkspace={() => setWorkspaceModalOpen(true)}
                onCreateChannel={() => setChannelModalOpen(true)}
                onNewDm={() => setDmModalOpen(true)}
                onOpenSettings={openSettings}
                onShowTutorial={() => setTutorialOpen(true)}
                onOpenSearch={() => setSearchOpen(true)}
                onSetStatus={(status: UserStatus) => {
                  void actions.setStatus(status);
                }}
                currentUser={me}
                theme={theme}
                resolvedTheme={resolvedTheme}
                onChangeTheme={setTheme}
              />
            </div>
          </div>
        )
      )}

      {activeChannel ? (
        <>
          <ChatWindow
            channel={activeChannel}
            users={state.users}
            currentUser={me}
            onOpenThread={(message) => setThreadRootId(message.id)}
            onOpenMembers={() => setMembersOpen(true)}
            onOpenSearch={() => setSearchOpen(true)}
            onOpenAiSettings={() => openSettings('ai')}
            hidden={Boolean(threadRoot) && !isDesktop}
            {...(isDesktop ? {} : { onToggleSidebar: () => setMobileNavOpen(true) })}
          />

          {threadRoot && (
            <ThreadView
              rootMessage={threadRoot}
              channel={activeChannel}
              users={state.users}
              currentUser={me}
              onClose={() => setThreadRootId(null)}
            />
          )}
        </>
      ) : (
        <section className="flex flex-1 flex-col items-center justify-center gap-4 bg-surface px-6 text-center">
          <h1 className="text-lg font-semibold text-ink">No conversations here yet</h1>
          <p className="max-w-sm text-sm text-ink-muted">
            This workspace does not have any channels you belong to. Create one to get started.
          </p>
          <button
            type="button"
            onClick={() => setChannelModalOpen(true)}
            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
          >
            Create a channel
          </button>
        </section>
      )}

      {error && (
        <div
          role="alert"
          className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-3 bg-danger px-4 py-2 text-sm text-white"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={dismissError}
            className="rounded px-2 py-0.5 font-medium underline-offset-2 hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      <Tutorial isOpen={tutorialOpen} onClose={() => setTutorialOpen(false)} />

      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        activeTab={settingsTab}
        onChangeTab={setSettingsTab}
        currentUser={me}
        theme={theme}
        onChangeTheme={setTheme}
      />

      <AddWorkspaceModal
        isOpen={workspaceModalOpen}
        onClose={() => setWorkspaceModalOpen(false)}
        onCreate={(name) => {
          void actions.createWorkspace(name).then((workspaceId) => {
            if (!workspaceId) return;
            setSelectedWorkspaceId(workspaceId);
            setSelectedChannelId('');
            setThreadRootId(null);
          });
        }}
      />

      <CreateChannelModal
        isOpen={channelModalOpen}
        onClose={() => setChannelModalOpen(false)}
        existingNames={existingChannelNames}
        onCreate={(name, channelType, description) => {
          void actions
            .createChannel(activeWorkspaceId, name, channelType, description)
            .then((channelId) => {
              if (channelId) selectChannel(channelId);
            });
        }}
      />

      <NewDmModal
        isOpen={dmModalOpen}
        onClose={() => setDmModalOpen(false)}
        candidates={dmCandidates(state, activeWorkspaceId)}
        onCreate={(memberIds) => {
          // The server returns the existing conversation when one matches, so
          // there is no client-side duplicate check to keep in sync.
          void actions.createDm(activeWorkspaceId, memberIds).then((channelId) => {
            if (channelId) selectChannel(channelId);
          });
        }}
      />

      <SearchModal
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        workspaceId={activeWorkspaceId}
        onJumpToChannel={selectChannel}
      />

      {activeChannel && (
        <MembersModal
          isOpen={membersOpen}
          onClose={() => setMembersOpen(false)}
          channel={activeChannel}
        />
      )}
    </div>
  );
};

export default App;
