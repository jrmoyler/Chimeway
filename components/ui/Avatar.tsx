import React, { useState } from 'react';
import type { User } from '../../types';
import { STATUS_LABEL } from './UserStatusIndicator';

/**
 * Avatar with an initials fallback and an optional presence dot.
 *
 * The original rendered `<img src={user?.avatar} alt={user?.name} />` with no
 * handling for a missing user or a failed load, which produced a broken-image
 * icon and an empty alt attribute.
 */

const STATUS_DOT: Record<User['status'], string> = {
  active: 'bg-status-active',
  idle: 'bg-status-idle',
  dnd: 'bg-status-dnd',
  away: 'bg-surface ring-2 ring-ink-subtle',
  offline: 'bg-surface ring-2 ring-ink-subtle',
};

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return (words[0] ?? '?').slice(0, 2).toUpperCase();
  return `${(words[0] ?? '')[0] ?? ''}${(words[1] ?? '')[0] ?? ''}`.toUpperCase();
}

interface Props {
  user: User | undefined;
  size?: number;
  showStatus?: boolean;
  className?: string;
  rounded?: 'full' | 'md';
}

const Avatar: React.FC<Props> = ({
  user,
  size = 36,
  showStatus = false,
  className = '',
  rounded = 'md',
}) => {
  const [failed, setFailed] = useState(false);
  const name = user?.name ?? 'Unknown user';
  const radius = rounded === 'full' ? 'rounded-full' : 'rounded-md';
  const dot = Math.max(8, Math.round(size * 0.32));

  return (
    <span
      className={`relative inline-flex shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      {user?.avatar && !failed ? (
        <img
          src={user.avatar}
          alt={name}
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className={`h-full w-full bg-sunken object-cover ${radius}`}
        />
      ) : (
        <span
          role="img"
          aria-label={name}
          className={`flex h-full w-full items-center justify-center bg-sunken font-semibold text-ink-muted ${radius}`}
          style={{ fontSize: Math.max(10, Math.round(size * 0.38)) }}
        >
          {initials(name)}
        </span>
      )}

      {showStatus && user ? (
        <span
          role="img"
          aria-label={STATUS_LABEL[user.status]}
          title={STATUS_LABEL[user.status]}
          className={`absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-surface ${STATUS_DOT[user.status]}`}
          style={{ width: dot, height: dot }}
        />
      ) : null}
    </span>
  );
};

export default Avatar;
