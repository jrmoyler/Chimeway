import React from 'react';
import type { Channel, User } from '../types';
import { channelLabel, channelMembers, dmCounterparts } from '../store/selectors';
import { useStore } from '../store/StoreProvider';
import Avatar from './ui/Avatar';
import { HashIcon } from './icons/HashIcon';
import { LockIcon } from './icons/LockIcon';
import { STATUS_LABEL } from './ui/UserStatusIndicator';

interface Props {
  channel: Channel;
  onOpenMembers: () => void;
  onOpenSearch: () => void;
  onToggleSidebar?: () => void;
}

const Header: React.FC<Props> = ({ channel, onOpenMembers, onOpenSearch, onToggleSidebar }) => {
  const { state } = useStore();
  /*
   * Real membership. The original wrote
   * `channel.members?.map(...) as User[] || users` - `as` binds tighter than
   * `||`, so any channel without a members array fell back to the entire user
   * list and every channel claimed to have all five people in it.
   */
  const members: User[] = channelMembers(state, channel);
  const label = channelLabel(state, channel);
  const counterparts = dmCounterparts(state, channel);
  const soloDm = channel.type === 'dm' && counterparts.length === 1 ? counterparts[0] : undefined;

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-4">
      <div className="flex min-w-0 items-center gap-2">
        {onToggleSidebar && (
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label="Open navigation"
            className="rounded-md p-1.5 text-ink-muted transition-colors hover:bg-hover hover:text-ink lg:hidden"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
            >
              <path d="M3 6h18M3 12h18M3 18h18" />
            </svg>
          </button>
        )}

        {channel.type === 'dm' ? (
          soloDm ? (
            <Avatar user={soloDm} size={24} rounded="full" showStatus />
          ) : (
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sunken text-xs font-semibold text-ink-muted">
              {counterparts.length}
            </span>
          )
        ) : channel.type === 'private' ? (
          <LockIcon className="h-5 w-5 shrink-0 text-ink-muted" aria-hidden="true" />
        ) : (
          <HashIcon className="h-5 w-5 shrink-0 text-ink-muted" aria-hidden="true" />
        )}

        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold text-ink">{label}</h1>
          {channel.description ? (
            <p className="truncate text-xs text-ink-muted">{channel.description}</p>
          ) : soloDm ? (
            <p className="truncate text-xs text-ink-muted">
              {soloDm.title} · {STATUS_LABEL[soloDm.status]}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onOpenSearch}
          aria-label="Search messages"
          title="Search messages"
          className="rounded-md p-1.5 text-ink-muted transition-colors hover:bg-hover hover:text-ink"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
        </button>

        <button
          type="button"
          onClick={onOpenMembers}
          className="flex items-center gap-2 rounded-md border border-line px-2 py-1 transition-colors hover:bg-hover"
          aria-label={`${members.length} members. View member list.`}
        >
          <span className="flex -space-x-1.5">
            {members.slice(0, 3).map((member) => (
              <Avatar key={member.id} user={member} size={22} rounded="full" />
            ))}
          </span>
          <span className="text-sm tabular-nums text-ink-muted">{members.length}</span>
        </button>
      </div>
    </header>
  );
};

export default Header;
