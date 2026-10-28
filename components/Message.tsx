import React, { useEffect, useRef, useState } from 'react';
import type { Message as MessageType, User } from '../types';
import { formatFullTimestamp, formatMessageTime } from '../lib/time';
import { useClickOutside } from '../hooks/useClickOutside';
import Avatar from './ui/Avatar';
import MessageText from './MessageText';
import AttachmentList from './AttachmentList';
import ConfirmationModal from './ui/ConfirmationModal';
import { ThreadsIcon } from './icons/ThreadsIcon';
import { PencilIcon } from './icons/PencilIcon';
import { TrashIcon } from './icons/TrashIcon';
import { SmileyIcon } from './icons/SmileyIcon';

const QUICK_EMOJIS = ['👍', '❤️', '😂', '🎉', '🤔', '🔥', '✅', '👀'];

interface Props {
  message: MessageType;
  author: User | undefined;
  users: User[];
  currentUser: User;
  replyCount: number;
  /** Omitted inside a thread panel, where opening a nested thread is invalid. */
  onOpenThread?: (message: MessageType) => void;
  onEdit: (messageId: string, text: string) => void;
  onDelete: (messageId: string) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  /** Hides the avatar and header for consecutive messages from one author. */
  compact?: boolean;
}

const Message: React.FC<Props> = ({
  message,
  author,
  users,
  currentUser,
  replyCount,
  onOpenThread,
  onEdit,
  onDelete,
  onToggleReaction,
  compact = false,
}) => {
  // `null` means not editing. Holding the draft this way removes the need for
  // an effect that re-synced it from props on every change.
  const [draft, setDraft] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const pickerRef = useRef<HTMLDivElement>(null);
  const pickerButtonRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isMine = message.userId === currentUser.id;
  const isEditing = draft !== null;
  const isDirty = isEditing && draft.trim() !== message.text;

  // The old emoji picker had no outside handler, unlike every other popover.
  useClickOutside(
    [pickerRef, pickerButtonRef],
    () => setPickerOpen(false),
    pickerOpen,
  );

  useEffect(() => {
    if (!isEditing) return;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [isEditing]);

  const commitEdit = () => {
    if (draft === null) return;
    const next = draft.trim();

    // Clearing a message and confirming used to silently discard the edit.
    // Treat it as an intent to delete and ask.
    if (!next) {
      setConfirmDelete(true);
      return;
    }

    if (next !== message.text) onEdit(message.id, next);
    setDraft(null);
  };

  const cancelEdit = () => {
    if (isDirty) {
      setConfirmDiscard(true);
      return;
    }
    setDraft(null);
  };

  const handleEditKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelEdit();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      commitEdit();
    }
  };

  const actionButton =
    'rounded p-1.5 text-ink-muted transition-colors hover:bg-hover hover:text-ink';

  return (
    <>
      <article
        className="group/message relative flex gap-3 rounded-md px-2 py-1 transition-colors hover:bg-hover/40"
        aria-label={`Message from ${author?.name ?? 'unknown user'}`}
      >
        <div className="w-9 shrink-0 pt-0.5">
          {compact ? (
            <time
              dateTime={message.createdAt}
              className="hidden select-none pt-1 text-[10px] text-ink-subtle group-hover/message:block"
            >
              {formatMessageTime(message.createdAt)}
            </time>
          ) : (
            <Avatar user={author} size={36} />
          )}
        </div>

        <div className="min-w-0 flex-1">
          {!compact && (
            <div className="flex items-baseline gap-2">
              <span className="font-semibold text-ink">{author?.name ?? 'Unknown user'}</span>
              <time
                dateTime={message.createdAt}
                title={formatFullTimestamp(message.createdAt)}
                className="text-xs text-ink-subtle"
              >
                {formatMessageTime(message.createdAt)}
              </time>
            </div>
          )}

          {isEditing ? (
            <div className="mt-1">
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleEditKeyDown}
                rows={3}
                aria-label="Edit message"
                className="w-full rounded-md border border-line bg-surface p-2 text-ink outline-none focus:border-accent"
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={commitEdit}
                  className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
                >
                  Save changes
                </button>
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="rounded-md px-3 py-1.5 text-sm text-ink transition-colors hover:bg-hover"
                >
                  Cancel
                </button>
                <span className="text-xs text-ink-subtle">
                  Enter to save · Shift+Enter for a new line · Esc to cancel
                </span>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline gap-x-2">
                <MessageText text={message.text} users={users} currentUser={currentUser} />
                {message.editedAt && (
                  <span
                    className="shrink-0 text-xs text-ink-subtle"
                    title={`Edited ${formatFullTimestamp(message.editedAt)}`}
                  >
                    (edited)
                  </span>
                )}
              </div>

              <AttachmentList attachments={message.attachments} />
            </>
          )}

          {message.reactions.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {message.reactions.map((reaction) => {
                const mine = reaction.userIds.includes(currentUser.id);
                const names = reaction.userIds
                  .map((id) => users.find((u) => u.id === id)?.name ?? 'Someone')
                  .join(', ');

                return (
                  <li key={reaction.emoji}>
                    <button
                      type="button"
                      onClick={() => onToggleReaction(message.id, reaction.emoji)}
                      title={`${names} reacted with ${reaction.emoji}`}
                      aria-pressed={mine}
                      className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm transition-colors ${
                        mine
                          ? 'border-accent bg-accent/15 text-accent'
                          : 'border-line bg-sunken text-ink-muted hover:border-ink-subtle'
                      }`}
                    >
                      <span aria-hidden="true">{reaction.emoji}</span>
                      {/* Count is derived, never stored, so it cannot drift. */}
                      <span className="tabular-nums">{reaction.userIds.length}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Only render the thread affordance when replies exist. The old
              check was `message.thread &&`, and an empty array is truthy, so
              it showed a "0 replies" button. */}
          {onOpenThread && replyCount > 0 && (
            <button
              type="button"
              onClick={() => onOpenThread(message)}
              className="mt-2 flex items-center gap-1.5 rounded px-1 py-0.5 text-sm font-medium text-accent transition-colors hover:underline"
            >
              <ThreadsIcon className="h-4 w-4" aria-hidden="true" />
              {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
            </button>
          )}
        </div>

        {!isEditing && (
          /* focus-within keeps these reachable by keyboard. Previously they
             were opacity-0 but still tabbable, so keyboard users focused
             invisible buttons. */
          <div className="absolute right-2 top-0 flex -translate-y-1/2 items-center gap-0.5 rounded-lg border border-line bg-raised p-0.5 opacity-0 shadow-sm transition-opacity focus-within:opacity-100 group-hover/message:opacity-100">
            <div className="relative">
              <button
                ref={pickerButtonRef}
                type="button"
                onClick={() => setPickerOpen((open) => !open)}
                aria-label="Add reaction"
                aria-expanded={pickerOpen}
                aria-haspopup="true"
                className={actionButton}
              >
                <SmileyIcon className="h-4 w-4" aria-hidden="true" />
              </button>

              {pickerOpen && (
                <div
                  ref={pickerRef}
                  role="menu"
                  aria-label="Quick reactions"
                  className="absolute bottom-full right-0 z-20 mb-1 flex gap-0.5 rounded-lg border border-line bg-raised p-1.5 shadow-lg"
                >
                  {QUICK_EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onToggleReaction(message.id, emoji);
                        setPickerOpen(false);
                      }}
                      aria-label={`React with ${emoji}`}
                      className="rounded p-1 text-lg leading-none transition-colors hover:bg-hover"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {onOpenThread && (
              <button
                type="button"
                onClick={() => onOpenThread(message)}
                aria-label={replyCount > 0 ? 'Open thread' : 'Reply in thread'}
                className={actionButton}
              >
                <ThreadsIcon className="h-4 w-4" aria-hidden="true" />
              </button>
            )}

            {isMine && (
              <>
                <button
                  type="button"
                  onClick={() => setDraft(message.text)}
                  aria-label="Edit message"
                  className={actionButton}
                >
                  <PencilIcon className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  aria-label="Delete message"
                  className={`${actionButton} hover:text-danger`}
                >
                  <TrashIcon className="h-4 w-4" aria-hidden="true" />
                </button>
              </>
            )}
          </div>
        )}
      </article>

      <ConfirmationModal
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          onDelete(message.id);
          setConfirmDelete(false);
          setDraft(null);
        }}
        title="Delete message"
        confirmText="Delete"
        variant="danger"
      >
        <p>This message will be permanently deleted. This cannot be undone.</p>
        {replyCount > 0 && (
          <p className="mt-2 font-medium text-danger">
            Its {replyCount} {replyCount === 1 ? 'reply' : 'replies'} will be deleted too.
          </p>
        )}
      </ConfirmationModal>

      <ConfirmationModal
        isOpen={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        onConfirm={() => {
          setDraft(null);
          setConfirmDiscard(false);
        }}
        title="Discard changes"
        confirmText="Discard"
        variant="danger"
      >
        <p>You have unsaved changes to this message. Discard them?</p>
      </ConfirmationModal>
    </>
  );
};

/**
 * Memoised: in a busy channel every state change re-rendered every row, and
 * each row does markdown parsing. With stable callbacks from the call sites,
 * only rows whose own data changed re-render.
 */
export default React.memo(Message);
