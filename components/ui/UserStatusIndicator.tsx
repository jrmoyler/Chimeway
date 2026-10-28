import React from 'react';
import type { UserStatus } from '../../types';

const STATUS_CLASS: Record<UserStatus, string> = {
  active: 'bg-status-active',
  idle: 'bg-status-idle',
  dnd: 'bg-status-dnd',
  away: 'bg-transparent ring-2 ring-ink-subtle',
  offline: 'bg-transparent ring-2 ring-ink-subtle',
};

export const STATUS_LABEL: Record<UserStatus, string> = {
  active: 'Active',
  idle: 'Idle',
  dnd: 'Do not disturb',
  away: 'Away',
  offline: 'Offline',
};

interface Props {
  status: UserStatus;
  className?: string;
  /** Omit the label when an adjacent element already names the status. */
  labelled?: boolean;
}

const UserStatusIndicator: React.FC<Props> = ({ status, className = '', labelled = true }) => (
  <span
    className={`inline-block shrink-0 rounded-full ${STATUS_CLASS[status]} ${className}`}
    role={labelled ? 'img' : undefined}
    aria-label={labelled ? STATUS_LABEL[status] : undefined}
    aria-hidden={labelled ? undefined : true}
  />
);

export default UserStatusIndicator;
