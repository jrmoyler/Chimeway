import React, { useMemo, useRef, useState } from 'react';
import type { Channel, ThemePreference, User, UserStatus, Workspace } from '../types';
import { channelLabel, dmCounterparts, visibleChannels } from '../store/selectors';
import { useStore, type UnreadSummary } from '../store/StoreProvider';
import { useClickOutside } from '../hooks/useClickOutside';
import Avatar from './ui/Avatar';
import UserProfileDropdown, { type SettingsTab } from './UserProfileDropdown';
import { HashIcon } from './icons/HashIcon';
import { LockIcon } from './icons/LockIcon';
import { PlusIcon } from './icons/PlusIcon';
import { SearchIcon } from './icons/SearchIcon';
import { ChevronDownIcon } from './icons/ChevronDownIcon';
import { FilterIcon } from './icons/FilterIcon';
import { QuestionMarkIcon } from './icons/QuestionMarkIcon';
import ThemeToggle from './ThemeToggle';

type ActiveFilter = 'unread' | 'active_users';

/*
 * ChannelRow and SectionHeader live at module scope. The original defined them
 * inside Sidebar's body, so a new component type was created on every render,
 * which React treats as a different component - remounting the whole list and
 * discarding its DOM state on each keystroke in the filter box.
 */

interface ChannelRowProps {
  channel: Channel;
  label: string;
  isActive: boolean;
  unread: number;
  mentioned: boolean;
  /** The single other person in a 1:1 DM; undefined for channels and groups. */
  counterpart: User | undefined;
  /** Number of other people, used for the group-DM badge. */
  groupSize: number;
  onSelect: (channelId: string) => void;
}

const ChannelRow: React.FC<ChannelRowProps> = ({
  channel,
  label,
  isActive,
  unread,
  mentioned,
  counterpart,
  groupSize,
  onSelect,
}) => {
  const hasUnread = unread > 0 && !isActive;

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(channel.id)}
        aria-current={isActive ? 'true' : undefined}
        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
          isActive
            ? 'bg-accent text-white'
            : hasUnread
              ? 'font-semibold text-ink hover:bg-hover'
              : 'text-ink-muted hover:bg-hover hover:text-ink'
        }`}
      >
        {channel.type === 'dm' ? (
          counterpart ? (
            <Avatar user={counterpart} size={18} rounded="full" showStatus />
          ) : (
            // Group DM: a member count reads better than one arbitrary avatar.
            <span
              aria-hidden="true"
              className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                isActive ? 'bg-white/25 text-white' : 'bg-sunken text-ink-muted'
              }`}
            >
              {groupSize}
            </span>
          )
        ) : channel.type === 'private' ? (
          <LockIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
        ) : (
          <HashIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
        )}

        <span className="min-w-0 flex-1 truncate">{label}</span>

        {hasUnread && (
          <span
            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${
              mentioned ? 'bg-danger text-white' : 'bg-accent text-white'
            }`}
            aria-label={`${unread} unread ${unread === 1 ? 'message' : 'messages'}${
              mentioned ? ', including a mention' : ''
            }`}
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
    </li>
  );
};

interface SectionHeaderProps {
  label: string;
  open: boolean;
  onToggle: () => void;
  onAdd?: () => void;
  addLabel?: string;
}

const SectionHeader: React.FC<SectionHeaderProps> = ({
  label,
  open,
  onToggle,
  onAdd,
  addLabel,
}) => (
  <div className="flex items-center justify-between px-2">
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex items-center gap-1 rounded px-1 py-0.5 text-xs font-bold uppercase tracking-wide text-ink-subtle transition-colors hover:text-ink"
    >
      <ChevronDownIcon
        className={`h-3.5 w-3.5 transition-transform ${open ? '' : '-rotate-90'}`}
        aria-hidden="true"
      />
      {label}
    </button>
    {onAdd && (
      <button
        type="button"
        onClick={onAdd}
        aria-label={addLabel}
        title={addLabel}
        className="rounded p-1 text-ink-subtle transition-colors hover:bg-hover hover:text-ink"
      >
        <PlusIcon className="h-4 w-4" aria-hidden="true" />
      </button>
    )}
  </div>
);

interface Props {
  workspaces: Workspace[];
  activeWorkspaceId: string;
  activeChannelId: string;
  onSelectWorkspace: (id: string) => void;
  onSelectChannel: (id: string) => void;
  onAddWorkspace: () => void;
  onCreateChannel: () => void;
  onNewDm: () => void;
  onOpenSettings: (tab: SettingsTab) => void;
  onShowTutorial: () => void;
  onOpenSearch: () => void;
  onSetStatus: (status: UserStatus) => void;
  currentUser: User;
  /** Unread summary per channel, computed by the server. */
  unread: Record<string, UnreadSummary>;
  theme: ThemePreference;
  resolvedTheme: 'light' | 'dark';
  onChangeTheme: (next: ThemePreference) => void;
}

const Sidebar: React.FC<Props> = ({
  workspaces,
  activeWorkspaceId,
  activeChannelId,
  onSelectWorkspace,
  onSelectChannel,
  onAddWorkspace,
  onCreateChannel,
  onNewDm,
  onOpenSettings,
  onShowTutorial,
  onOpenSearch,
  onSetStatus,
  currentUser,
  unread,
  theme,
  resolvedTheme,
  onChangeTheme,
}) => {
  const { state } = useStore();
  const [query, setQuery] = useState('');
  const [channelsOpen, setChannelsOpen] = useState(true);
  const [dmsOpen, setDmsOpen] = useState(true);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState<Set<ActiveFilter>>(new Set());
  const [profileOpen, setProfileOpen] = useState(false);

  const filterRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);

  useClickOutside([filterRef], () => setFilterOpen(false), filterOpen);

  const grouped = useMemo(
    () => visibleChannels(state, activeWorkspaceId),
    [state, activeWorkspaceId],
  );

  const matches = (channel: Channel): boolean => {
    const label = channelLabel(state, channel).toLowerCase();
    if (query && !label.includes(query.trim().toLowerCase())) return false;

    if (filters.has('unread') && (unread[channel.id]?.count ?? 0) === 0) return false;

    if (filters.has('active_users') && channel.type === 'dm') {
      const others = dmCounterparts(state, channel);
      if (!others.some((u) => u.status === 'active')) return false;
    }

    return true;
  };

  const toggleFilter = (filter: ActiveFilter) =>
    setFilters((current) => {
      const next = new Set(current);
      if (next.has(filter)) next.delete(filter);
      else next.add(filter);
      return next;
    });

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);

  const renderRows = (channels: Channel[]) =>
    channels.filter(matches).map((channel) => {
      const others = dmCounterparts(state, channel);
      const summary = unread[channel.id];
      return (
        <ChannelRow
          key={channel.id}
          channel={channel}
          label={channelLabel(state, channel)}
          isActive={channel.id === activeChannelId}
          unread={summary?.count ?? 0}
          mentioned={Boolean(summary?.hasMention)}
          counterpart={others.length === 1 ? others[0] : undefined}
          groupSize={others.length}
          onSelect={onSelectChannel}
        />
      );
    });

  const publicRows = renderRows(grouped.public);
  const privateRows = renderRows(grouped.private);
  const dmRows = renderRows(grouped.dms);
  const nothingMatches =
    publicRows.length === 0 && privateRows.length === 0 && dmRows.length === 0;

  return (
    <div className="flex h-full">
      {/* Workspace rail */}
      <nav
        aria-label="Workspaces"
        className="flex w-16 shrink-0 flex-col items-center gap-2 border-r border-line bg-base py-3"
      >
        {workspaces.map((workspace) => {
          const isActive = workspace.id === activeWorkspaceId;
          return (
            <div key={workspace.id} className="group relative flex w-full justify-center">
              <span
                aria-hidden="true"
                className={`absolute left-0 top-1/2 w-1 -translate-y-1/2 rounded-r-full bg-ink transition-all ${
                  isActive ? 'h-8' : 'h-0 group-hover:h-4'
                }`}
              />
              <button
                type="button"
                onClick={() => onSelectWorkspace(workspace.id)}
                aria-label={`${workspace.name} workspace`}
                aria-current={isActive ? 'true' : undefined}
                title={workspace.name}
                style={{ backgroundColor: workspace.color }}
                className={`flex h-10 w-10 items-center justify-center text-sm font-bold text-white transition-all ${
                  isActive ? 'rounded-xl' : 'rounded-full group-hover:rounded-xl'
                }`}
              >
                {workspace.initials}
              </button>
            </div>
          );
        })}

        <button
          type="button"
          onClick={onAddWorkspace}
          aria-label="Create a workspace"
          title="Create a workspace"
          className="group flex h-10 w-10 items-center justify-center rounded-full bg-sunken text-ink-muted transition-all hover:rounded-xl hover:bg-accent hover:text-white"
        >
          <PlusIcon className="h-5 w-5 transition-transform group-hover:rotate-90" aria-hidden="true" />
        </button>
      </nav>

      {/* Channel list */}
      <div className="flex w-60 min-w-0 shrink-0 flex-col border-r border-line bg-sidebar">
        <header className="flex h-14 shrink-0 items-center border-b border-line px-4">
          <h2 className="truncate text-base font-bold text-ink">{activeWorkspace?.name}</h2>
        </header>

        <div ref={filterRef} className="relative flex items-center gap-1.5 px-3 py-3">
          <div className="relative min-w-0 flex-1">
            <SearchIcon
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle"
              aria-hidden="true"
            />
            <label htmlFor="channel-filter" className="sr-only">
              Filter channels and direct messages
            </label>
            <input
              id="channel-filter"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter conversations"
              className="w-full rounded-md border border-line bg-surface py-1.5 pl-8 pr-2 text-sm text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none"
            />
          </div>

          <button
            type="button"
            onClick={() => setFilterOpen((open) => !open)}
            aria-label="Filter options"
            aria-expanded={filterOpen}
            aria-haspopup="true"
            className={`shrink-0 rounded-md border p-1.5 transition-colors ${
              filters.size > 0
                ? 'border-accent bg-accent/15 text-accent'
                : 'border-line text-ink-muted hover:bg-hover hover:text-ink'
            }`}
          >
            <FilterIcon className="h-4 w-4" aria-hidden="true" />
          </button>

          {filterOpen && (
            <div
              role="group"
              aria-label="Filter conversations"
              className="absolute right-3 top-full z-30 w-60 rounded-lg border border-line bg-raised p-2 shadow-xl"
            >
              <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                Filter by
              </p>
              <label className="flex cursor-pointer items-center gap-2 rounded-md p-2 hover:bg-hover">
                <input
                  type="checkbox"
                  checked={filters.has('unread')}
                  onChange={() => toggleFilter('unread')}
                  className="h-4 w-4 accent-[var(--app-accent)]"
                />
                <span className="select-none text-sm text-ink">Unread only</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2 rounded-md p-2 hover:bg-hover">
                <input
                  type="checkbox"
                  checked={filters.has('active_users')}
                  onChange={() => toggleFilter('active_users')}
                  className="h-4 w-4 accent-[var(--app-accent)]"
                />
                <span className="select-none text-sm text-ink">DMs with active people</span>
              </label>
              {filters.size > 0 && (
                <>
                  <span className="my-1 block h-px bg-line" />
                  <button
                    type="button"
                    onClick={() => {
                      setFilters(new Set());
                      setFilterOpen(false);
                    }}
                    className="w-full rounded-md p-2 text-left text-sm text-danger transition-colors hover:bg-hover"
                  >
                    Clear filters
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <div className="px-3 pb-2">
          <button
            type="button"
            onClick={onOpenSearch}
            className="flex w-full items-center gap-2 rounded-md border border-dashed border-line px-2 py-1.5 text-left text-sm text-ink-subtle transition-colors hover:border-accent hover:text-ink"
          >
            <SearchIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
            Search all messages
          </button>
        </div>

        <nav aria-label="Conversations" className="flex-1 space-y-4 overflow-y-auto px-2 pb-3">
          <section>
            <SectionHeader
              label="Channels"
              open={channelsOpen}
              onToggle={() => setChannelsOpen((open) => !open)}
              onAdd={onCreateChannel}
              addLabel="Create a channel"
            />
            {channelsOpen && (
              <ul className="mt-1 space-y-0.5">
                {publicRows}
                {privateRows}
              </ul>
            )}
          </section>

          <section>
            <SectionHeader
              label="Direct messages"
              open={dmsOpen}
              onToggle={() => setDmsOpen((open) => !open)}
              onAdd={onNewDm}
              addLabel="Start a direct message"
            />
            {dmsOpen && <ul className="mt-1 space-y-0.5">{dmRows}</ul>}
          </section>

          {nothingMatches && (
            <p className="px-3 py-4 text-sm text-ink-subtle">
              {query || filters.size > 0
                ? 'Nothing matches those filters.'
                : 'No conversations in this workspace yet.'}
            </p>
          )}
        </nav>

        <footer ref={profileRef} className="relative shrink-0 border-t border-line p-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              id="user-menu-button"
              onClick={() => setProfileOpen((open) => !open)}
              aria-expanded={profileOpen}
              aria-haspopup="true"
              aria-controls="user-menu"
              className="flex min-w-0 flex-1 items-center gap-2 rounded-md p-1.5 text-left transition-colors hover:bg-hover"
            >
              <Avatar user={currentUser} size={26} rounded="full" showStatus />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
                {currentUser.name}
              </span>
            </button>

            <ThemeToggle theme={theme} resolved={resolvedTheme} onChange={onChangeTheme} />

            <button
              type="button"
              onClick={onShowTutorial}
              aria-label="What is Chimeway?"
              title="What is Chimeway?"
              className="shrink-0 rounded-md p-1.5 text-ink-muted transition-colors hover:bg-hover hover:text-ink"
            >
              <QuestionMarkIcon className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          <UserProfileDropdown
            isOpen={profileOpen}
            onClose={() => setProfileOpen(false)}
            anchorRef={profileRef}
            currentUser={currentUser}
            onOpenSettings={onOpenSettings}
            onSetStatus={onSetStatus}
          />
        </footer>
      </div>
    </div>
  );
};

export default Sidebar;
