import React, { useMemo, useState } from 'react';
import type { User } from '../types';
import Modal from './ui/Modal';
import Avatar from './ui/Avatar';
import { STATUS_LABEL } from './ui/UserStatusIndicator';
import { CheckIcon } from './icons/CheckIcon';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  candidates: User[];
  onCreate: (memberIds: string[]) => void;
}

/**
 * Starting a direct message. The original had no way to create one at all -
 * only the three seeded conversations existed.
 */
const NewDmModalBody: React.FC<Omit<Props, 'isOpen'>> = ({ onClose, candidates, onCreate }) => {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return candidates;
    return candidates.filter(
      (u) =>
        u.name.toLowerCase().includes(needle) || u.displayName.toLowerCase().includes(needle),
    );
  }, [candidates, query]);

  const toggle = (userId: string) =>
    setSelected((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    );

  const submit = () => {
    if (selected.length === 0) return;
    onCreate(selected);
    onClose();
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="New direct message"
      size="sm"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-ink-muted">
            {selected.length === 0
              ? 'Pick at least one person'
              : `${selected.length} selected${selected.length > 1 ? ' — group chat' : ''}`}
          </span>
          <button
            type="button"
            onClick={submit}
            disabled={selected.length === 0}
            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            Start chat
          </button>
        </div>
      }
    >
      <label htmlFor="dm-search" className="sr-only">
        Search people
      </label>
      <input
        id="dm-search"
        data-autofocus
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search people"
        className="mb-3 block w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none"
      />

      {filtered.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-subtle">No one matches that search.</p>
      ) : (
        <ul className="max-h-72 space-y-0.5 overflow-y-auto">
          {filtered.map((user) => {
            const isSelected = selected.includes(user.id);
            return (
              <li key={user.id}>
                <button
                  type="button"
                  onClick={() => toggle(user.id)}
                  aria-pressed={isSelected}
                  className={`flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors ${
                    isSelected ? 'bg-accent/10' : 'hover:bg-hover'
                  }`}
                >
                  <Avatar user={user} size={32} rounded="full" showStatus />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{user.name}</span>
                    <span className="block truncate text-xs text-ink-subtle">
                      {user.title} · {STATUS_LABEL[user.status]}
                    </span>
                  </span>
                  {isSelected && <CheckIcon className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
};

const NewDmModal: React.FC<Props> = ({ isOpen, ...rest }) =>
  isOpen ? <NewDmModalBody {...rest} /> : null;

export default NewDmModal;
