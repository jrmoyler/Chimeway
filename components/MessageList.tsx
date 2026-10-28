import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Message as MessageType, User } from '../types';
import { dayKey, formatDayDivider } from '../lib/time';
import MessageComponent from './Message';

const NEAR_BOTTOM_PX = 120;
/**
 * Only the most recent slice is rendered initially, with older messages
 * revealed on demand. Rendering an entire history at once cost ~2.7s of
 * blocking work in a channel with a few hundred messages, because every row
 * parses markdown.
 */
const INITIAL_WINDOW = 80;
const WINDOW_STEP = 120;
/** Consecutive messages from one author within this window are grouped. */
const GROUPING_WINDOW_MS = 5 * 60 * 1000;

interface Props {
  messages: MessageType[];
  users: User[];
  currentUser: User;
  /** Precomputed so each row is an O(1) lookup rather than a full scan. */
  replyCounts: Map<string, number>;
  usersById: Map<string, User>;
  onOpenThread?: (message: MessageType) => void;
  onEdit: (messageId: string, text: string) => void;
  onDelete: (messageId: string) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  emptyState: React.ReactNode;
}

const MessageList: React.FC<Props> = ({
  messages,
  users,
  currentUser,
  replyCounts,
  usersById,
  onOpenThread,
  onEdit,
  onDelete,
  onToggleReaction,
  emptyState,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);
  const hasRendered = useRef(false);
  const [showJumpButton, setShowJumpButton] = useState(false);
  const [windowSize, setWindowSize] = useState(INITIAL_WINDOW);

  const visible = useMemo(
    () => (messages.length > windowSize ? messages.slice(-windowSize) : messages),
    [messages, windowSize],
  );
  const hiddenCount = messages.length - visible.length;

  const scrollToBottom = (behavior: ScrollBehavior) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  };

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    pinnedToBottom.current = distance <= NEAR_BOTTOM_PX;
    setShowJumpButton(!pinnedToBottom.current);
  };

  /*
   * Only follow new messages when the reader is already at the bottom. The
   * original called scrollIntoView on every change, which yanked you back
   * down mid-read, and animated on mount.
   */
  useLayoutEffect(() => {
    if (!hasRendered.current) {
      scrollToBottom('auto');
      hasRendered.current = true;
      return;
    }
    if (pinnedToBottom.current) scrollToBottom('smooth');
  }, [messages]);

  /*
   * Day dividers and author grouping are computed up front rather than by
   * mutating locals inside the render map, which is not safe across React's
   * concurrent rendering.
   */
  const rows = useMemo(
    () =>
      visible.map((message, index) => {
      const previous = index > 0 ? visible[index - 1] : undefined;
      const showDivider =
        previous === undefined || dayKey(previous.createdAt) !== dayKey(message.createdAt);

      const grouped =
        !showDivider &&
        previous !== undefined &&
        previous.userId === message.userId &&
        new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() <
          GROUPING_WINDOW_MS;

      return { message, showDivider, grouped };
      }),
    [visible],
  );

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">{emptyState}</div>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-4"
      >
        {hiddenCount > 0 && (
          <div className="mb-4 flex justify-center">
            <button
              type="button"
              onClick={() => {
                // Keep the reader's place: preserve distance from the bottom.
                const el = scrollRef.current;
                const fromBottom = el ? el.scrollHeight - el.scrollTop : 0;
                setWindowSize((n) => n + WINDOW_STEP);
                queueMicrotask(() => {
                  if (el) el.scrollTop = el.scrollHeight - fromBottom;
                });
              }}
              className="rounded-full border border-line bg-raised px-4 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-hover"
            >
              Load {Math.min(hiddenCount, WINDOW_STEP)} older
              {hiddenCount > WINDOW_STEP ? ` of ${hiddenCount}` : ''}
            </button>
          </div>
        )}
        {rows.map(({ message, showDivider, grouped }) => {
          return (
            <React.Fragment key={message.id}>
              {showDivider && (
                <div className="my-4 flex items-center gap-3" role="separator">
                  <span className="h-px flex-1 bg-line" />
                  <span className="rounded-full border border-line bg-surface px-3 py-0.5 text-xs font-medium text-ink-muted">
                    {formatDayDivider(message.createdAt)}
                  </span>
                  <span className="h-px flex-1 bg-line" />
                </div>
              )}
              <div className={grouped ? 'mt-0.5' : 'mt-3 first:mt-0'}>
                <MessageComponent
                  message={message}
                  author={usersById.get(message.userId)}
                  users={users}
                  currentUser={currentUser}
                  replyCount={replyCounts.get(message.id) ?? 0}
                  onOpenThread={onOpenThread}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onToggleReaction={onToggleReaction}
                  compact={grouped}
                />
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {showJumpButton && (
        <button
          type="button"
          onClick={() => {
            scrollToBottom('smooth');
            pinnedToBottom.current = true;
            setShowJumpButton(false);
          }}
          className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-line bg-raised px-3 py-1.5 text-xs font-medium text-ink shadow-lg transition-colors hover:bg-hover"
        >
          Jump to latest
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      )}
    </div>
  );
};

export default MessageList;
