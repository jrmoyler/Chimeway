import React, { useEffect, useRef, useState } from 'react';
import type { Message } from '../types';
import { channelById, channelLabel } from '../store/selectors';
import { useStore } from '../store/StoreProvider';
import { searchMessages } from '../data/api';
import { formatDayDivider, formatMessageTime } from '../lib/time';
import Modal from './ui/Modal';
import Avatar from './ui/Avatar';
import { HashIcon } from './icons/HashIcon';
import { LockIcon } from './icons/LockIcon';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string;
  onJumpToChannel: (channelId: string) => void;
}

/** Highlights the matched substring without using dangerouslySetInnerHTML. */
const Highlighted: React.FC<{ text: string; needle: string }> = ({ text, needle }) => {
  const index = text.toLowerCase().indexOf(needle.toLowerCase());
  if (index === -1 || !needle) return <>{text}</>;

  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded bg-status-idle/35 px-0.5 text-ink">
        {text.slice(index, index + needle.length)}
      </mark>
      {text.slice(index + needle.length)}
    </>
  );
};

/**
 * Full-text message search.
 *
 * The original only filtered channel names in the sidebar; message bodies were
 * never searchable.
 */
const SearchModalBody: React.FC<Omit<Props, 'isOpen'>> = ({
  onClose,
  workspaceId,
  onJumpToChannel,
}) => {
  const { state } = useStore();
  const [query, setQuery] = useState('');
  // Results are stored together with the query they answer, so a stale
  // response is simply not displayed rather than having to be cleared by an
  // effect before the next search starts.
  const [outcome, setOutcome] = useState<{
    query: string;
    hits: Message[];
    failed: boolean;
  }>({ query: '', hits: [], failed: false });
  const requestId = useRef(0);

  const trimmed = query.trim();

  /*
   * Search runs on the server, over every message the viewer can read - the
   * client cache only holds the channels that have been opened, so searching
   * it locally would silently miss most of the workspace.
   *
   * Debounced, and stale responses are discarded by sequence number so a slow
   * early request cannot overwrite the results of a later one.
   */
  useEffect(() => {
    if (trimmed.length < 2) return;

    const id = ++requestId.current;

    const timer = setTimeout(() => {
      void searchMessages(workspaceId, trimmed)
        .then((hits) => {
          if (requestId.current !== id) return;
          setOutcome({ query: trimmed, hits, failed: false });
        })
        .catch(() => {
          if (requestId.current !== id) return;
          setOutcome({ query: trimmed, hits: [], failed: true });
        });
    }, 250);

    return () => clearTimeout(timer);
  }, [trimmed, workspaceId]);

  const answered = outcome.query === trimmed;
  const searching = trimmed.length >= 2 && !answered;
  const failed = answered && outcome.failed;
  const results = answered ? outcome.hits : [];

  return (
    <Modal isOpen onClose={onClose} title="Search messages" size="md">
      <label htmlFor="message-search" className="sr-only">
        Search messages
      </label>
      <input
        id="message-search"
        data-autofocus
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search every message in this workspace"
        className="block w-full rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none"
      />

      <div className="mt-4 min-h-32">
        {trimmed.length < 2 ? (
          <p className="py-8 text-center text-sm text-ink-subtle">
            Type at least two characters to search.
          </p>
        ) : searching ? (
          <div
            className="flex items-center justify-center gap-3 py-8 text-sm text-ink-muted"
            role="status"
            aria-live="polite"
          >
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-accent" />
            Searching…
          </div>
        ) : failed ? (
          <p role="alert" className="py-8 text-center text-sm text-danger">
            Search failed. Please try again.
          </p>
        ) : results.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-subtle">
            No messages match “{trimmed}”.
          </p>
        ) : (
          <>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
              {results.length} {results.length === 1 ? 'result' : 'results'}
            </p>
            <ul className="max-h-80 space-y-1 overflow-y-auto">
              {results.map((message) => {
                const channel = channelById(state, message.channelId);
                const author = state.users.find((u) => u.id === message.userId);
                if (!channel) return null;
                return (
                <li key={message.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onJumpToChannel(channel.id);
                      onClose();
                    }}
                    className="w-full rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors hover:border-line hover:bg-hover"
                  >
                    <span className="flex items-center gap-1.5 text-xs text-ink-subtle">
                      {channel.type === 'private' ? (
                        <LockIcon className="h-3 w-3" aria-hidden="true" />
                      ) : channel.type === 'public' ? (
                        <HashIcon className="h-3 w-3" aria-hidden="true" />
                      ) : null}
                      <span className="font-medium">{channelLabel(state, channel)}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {formatDayDivider(message.createdAt)} at{' '}
                        {formatMessageTime(message.createdAt)}
                      </span>
                      {message.parentId && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>in a thread</span>
                        </>
                      )}
                    </span>

                    <span className="mt-1.5 flex items-start gap-2">
                      <Avatar user={author} size={20} rounded="full" />
                      <span className="min-w-0 flex-1">
                        <span className="text-sm font-medium text-ink">
                          {author?.name ?? 'Unknown user'}
                        </span>
                        <span className="mt-0.5 line-clamp-2 block text-sm text-ink-muted">
                          <Highlighted text={message.text} needle={trimmed} />
                        </span>
                      </span>
                    </span>
                  </button>
                </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </Modal>
  );
};

const SearchModal: React.FC<Props> = ({ isOpen, ...rest }) =>
  isOpen ? <SearchModalBody {...rest} /> : null;

export default SearchModal;
