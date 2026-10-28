import React, { useCallback, useMemo } from 'react';
import type { Channel, Message, User } from '../types';
import { channelLabel, threadReplies, usersById } from '../store/selectors';
import { useStore } from '../store/StoreProvider';
import MessageComponent from './Message';
import MessageInput from './MessageInput';
import AiActionBar from './AiActionBar';

interface Props {
  rootMessage: Message;
  channel: Channel;
  users: User[];
  currentUser: User;
  onClose: () => void;
}

/**
 * Thread panel.
 *
 * The previous version wired eight no-op handlers and shipped with the comment
 * "A reply input could go here, but omitted for simplicity" - so replies could
 * be read but never written, edited, deleted or reacted to, while the controls
 * for all of those were still rendered and silently did nothing.
 */
const ThreadView: React.FC<Props> = ({ rootMessage, channel, users, currentUser, onClose }) => {
  const { state, actions } = useStore();
  const replies = useMemo(() => threadReplies(state, rootMessage.id), [state, rootMessage.id]);
  const userMap = useMemo(() => usersById(state), [state]);

  const send = useCallback(
    (text: string, files: File[]) => {
      void actions.sendMessage({
        channelId: channel.id,
        parentId: rootMessage.id,
        text,
        files,
      });
    },
    [actions, channel.id, rootMessage.id],
  );

  const edit = useCallback(
    (messageId: string, text: string) => {
      void actions.editMessage(messageId, text);
    },
    [actions],
  );

  const remove = useCallback(
    (messageId: string) => {
      void actions.deleteMessage(messageId);
      // Deleting the root removes the thread itself, so close the panel.
      if (messageId === rootMessage.id) onClose();
    },
    [actions, rootMessage.id, onClose],
  );

  const react = useCallback(
    (messageId: string, emoji: string) => {
      void actions.toggleReaction(messageId, emoji);
    },
    [actions],
  );

  const label = channelLabel(state, channel);

  return (
    <aside
      aria-label="Thread"
      className="flex w-full min-w-0 flex-col border-l border-line bg-surface lg:w-[400px] lg:shrink-0"
    >
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line px-4">
        <div className="min-w-0">
          <h2 className="font-semibold text-ink">Thread</h2>
          <p className="truncate text-sm text-ink-muted">
            {channel.type === 'dm' ? label : `#${label}`}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close thread"
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
            <path d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <MessageComponent
          message={rootMessage}
          author={userMap.get(rootMessage.userId)}
          users={users}
          currentUser={currentUser}
          replyCount={0}
          onEdit={edit}
          onDelete={remove}
          onToggleReaction={react}
        />

        <div className="my-4 flex items-center gap-3" role="separator">
          <span className="h-px flex-1 bg-line" />
          <span className="text-xs font-medium text-ink-muted">
            {replies.length === 0
              ? 'No replies yet'
              : `${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`}
          </span>
          <span className="h-px flex-1 bg-line" />
        </div>

        <div className="flex flex-col gap-3">
          {replies.map((reply) => (
            <MessageComponent
              key={reply.id}
              message={reply}
              author={userMap.get(reply.userId)}
              users={users}
              currentUser={currentUser}
              replyCount={0}
              onEdit={edit}
              onDelete={remove}
              onToggleReaction={react}
            />
          ))}
        </div>
      </div>

      <div className="shrink-0 border-t border-line px-4 py-3">
        <MessageInput
          key={rootMessage.id}
          draftKey={`thread-${rootMessage.id}`}
          placeholder="Reply in thread"
          users={users}
          onSend={send}
        />
        <AiActionBar
          mode="thread"
          channelId={channel.id}
          rootMessage={rootMessage}
          users={users}
        />
      </div>
    </aside>
  );
};

export default ThreadView;
