import React, { useEffect, useRef } from 'react';
import type { User, UserStatus } from '../types';
import { useClickOutside } from '../hooks/useClickOutside';
import Avatar from './ui/Avatar';
import UserStatusIndicator, { STATUS_LABEL } from './ui/UserStatusIndicator';
import { UserIcon } from './icons/UserIcon';
import { SettingsIcon } from './icons/SettingsIcon';
import { LogoutIcon } from './icons/LogoutIcon';
import { ClockIcon } from './icons/ClockIcon';
import { MinusCircleIcon } from './icons/MinusCircleIcon';
import { CheckIcon } from './icons/CheckIcon';

export type SettingsTab = 'profile' | 'preferences' | 'ai';

const SELECTABLE: Array<{ status: UserStatus; icon: React.ReactNode }> = [
  { status: 'active', icon: <UserStatusIndicator status="active" className="h-3 w-3" labelled={false} /> },
  { status: 'idle', icon: <ClockIcon className="h-4 w-4 text-status-idle" aria-hidden="true" /> },
  { status: 'dnd', icon: <MinusCircleIcon className="h-4 w-4 text-status-dnd" aria-hidden="true" /> },
  { status: 'away', icon: <UserStatusIndicator status="away" className="h-3 w-3" labelled={false} /> },
];

interface Props {
  isOpen: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  currentUser: User;
  onOpenSettings: (tab: SettingsTab) => void;
  onSetStatus: (status: UserStatus) => void;
}

/**
 * Account menu.
 *
 * The original declared `role="menu"` but implemented no keyboard interaction
 * at all, and its "Log out" item had no handler, so clicking it did nothing
 * silently. This adds roving arrow-key navigation, Escape to close, and an
 * explanation of why sign-out is unavailable rather than a dead control.
 */
const UserProfileDropdown: React.FC<Props> = ({
  isOpen,
  onClose,
  anchorRef,
  currentUser,
  onOpenSettings,
  onSetStatus,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useClickOutside([menuRef, anchorRef], onClose, isOpen);

  useEffect(() => {
    if (!isOpen) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [isOpen]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;

    event.preventDefault();
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );
    if (items.length === 0) return;

    const index = items.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === 'ArrowDown'
        ? items[(index + 1) % items.length]
        : items[(index - 1 + items.length) % items.length];
    next?.focus();
  };

  if (!isOpen) return null;

  const itemClass =
    'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-hover';

  return (
    <div
      id="user-menu"
      ref={menuRef}
      role="menu"
      aria-orientation="vertical"
      aria-labelledby="user-menu-button"
      onKeyDown={handleKeyDown}
      className="absolute bottom-full left-2 right-2 z-30 mb-2 overflow-hidden rounded-lg border border-line bg-raised shadow-2xl"
    >
      <div className="flex items-center gap-3 border-b border-line p-4">
        <Avatar user={currentUser} size={40} />
        <div className="min-w-0">
          <p className="truncate font-semibold text-ink">{currentUser.name}</p>
          <p className="flex items-center gap-1.5 truncate text-sm text-ink-muted">
            <UserStatusIndicator status={currentUser.status} className="h-2 w-2" labelled={false} />
            {STATUS_LABEL[currentUser.status]}
          </p>
        </div>
      </div>

      <div className="p-1.5">
        <p className="px-3 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
          Set yourself as
        </p>
        {SELECTABLE.map(({ status, icon }) => (
          <button
            key={status}
            type="button"
            role="menuitem"
            onClick={() => {
              onSetStatus(status);
              onClose();
            }}
            className={itemClass}
          >
            {icon}
            <span className="flex-1">{STATUS_LABEL[status]}</span>
            {currentUser.status === status && (
              <CheckIcon className="h-4 w-4 text-accent" aria-hidden="true" />
            )}
          </button>
        ))}
      </div>

      <div className="border-t border-line p-1.5">
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onOpenSettings('profile');
            onClose();
          }}
          className={itemClass}
        >
          <UserIcon className="h-5 w-5" aria-hidden="true" />
          Profile
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onOpenSettings('preferences');
            onClose();
          }}
          className={itemClass}
        >
          <SettingsIcon className="h-5 w-5" aria-hidden="true" />
          Preferences
        </button>
      </div>

      <div className="border-t border-line p-1.5">
        {/* Honest about the current state instead of a control that does
            nothing: there are no accounts to sign out of until the backend
            lands. */}
        <div
          className="flex items-start gap-3 rounded-md px-3 py-2 text-sm text-ink-subtle"
          title="Chimeway does not have accounts yet"
        >
          <LogoutIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <span>
            <span className="block font-medium text-ink-muted">Sign out</span>
            <span className="block text-xs">Available once accounts are added.</span>
          </span>
        </div>
      </div>
    </div>
  );
};

export default UserProfileDropdown;
