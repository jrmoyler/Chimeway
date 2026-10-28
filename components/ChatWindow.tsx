import React, { useCallback, useMemo } from 'react';
import type { Channel, Message, User } from '../types';
import { channelLabel, replyCountsByRoot, rootMessages, usersById } from '../store/selectors';
import { useStore } from '../store/StoreProvider';
import Header from './Header';
import MessageList from './MessageList';
import MessageInput from './MessageInput';
import AiActionBar from './AiActionBar';
import { HashIcon } from './icons/HashIcon';

interface Props {
  channel: Channel;
  users: User[];
  currentUser: User;
  onOpenThread: (message: Message) => void;
  onOpenMembers: () => void;
  onOpenSearch: () => void;
  onOpenAiSettings: () => void;
  onToggleSidebar?: () => void;
  /**
   * Hidden rather than unmounted when a thread takes over the screen on
   * mobile, so scroll position and the in-progress draft survive.
   */
  hidden?: boolean;
}

const ChatWindow: React.FC<Props> = ({
  channel,
  users,
  currentUser,
  onOpenThread,
  onOpenMembers,
  onOpenSearch,
  onOpenAiSettings,
  onToggleSidebar,
  hidden = false,
}) => {
  const { state, actions, loadingChannel } = useStore();

  const messages = useMemo(() => rootMessages(state, channel.id), [state, channel.id]);
  const replyCounts = useMemo(() => replyCountsByRoot(state), [state]);
  const userMap = useMemo(() => usersById(state), [state]);
  const label = channelLabel(state, channel);

  const send = useCallback(
    (text: string, files: File[]) => {
      void actions.sendMessage({ channelId: channel.id, parentId: null, text, files });
    },
    [actions, channel.id],
  );

  // Stable identities so memoised message rows are not invalidated every render.
  const handleEdit = useCallback(
    (messageId: string, text: string) => {
      void actions.editMessage(messageId, text);
    },
    [actions],
  );
  const handleDelete = useCallback(
    (messageId: string) => {
      void actions.deleteMessage(messageId);
    },
    [actions],
  );
  const handleToggleReaction = useCallback(
    (messageId: string, emoji: string) => {
      void actions.toggleReaction(messageId, emoji);
    },
    [actions],
  );

  return (
    <main
      id="main-content"
      aria-label={`Conversation: ${label}`}
      aria-hidden={hidden || undefined}
      className={`min-w-0 flex-1 flex-col bg-surface ${hidden ? 'hidden' : 'flex'}`}
    >
      <Header
        channel={channel}
        onOpenMembers={onOpenMembers}
        onOpenSearch={onOpenSearch}
        onToggleSidebar={onToggleSidebar}
      />

      <MessageList
        key={channel.id}
        messages={messages}
        users={users}
        currentUser={currentUser}
        replyCounts={replyCounts}
        usersById={userMap}
        onOpenThread={onOpenThread}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onToggleReaction={handleToggleReaction}
        emptyState={
          loadingChannel === channel.id ? (
            <div className="flex items-center gap-3 text-sm text-ink-muted" role="status">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-accent" />
              Loading conversation…
            </div>
          ) : (
          <div className="max-w-sm px-6 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-sunken">
              <HashIcon className="h-6 w-6 text-ink-muted" aria-hidden="true" />
            </span>
            <h2 className="mt-4 text-lg font-semibold text-ink">
              {channel.type === 'dm' ? label : `#${label}`}
            </h2>
            <p className="mt-1.5 text-sm text-ink-muted">
              {channel.type === 'dm'
                ? 'This is the start of your conversation. Say hello.'
                : 'This is the very beginning of this channel. Send the first message to get it going.'}
            </p>
          </div>
          )
        }
      />

      <div className="shrink-0 px-4 pb-4">
        <MessageInput
          key={channel.id}
          draftKey={channel.id}
          placeholder={
            // The original hardcoded a "#", so DMs read "Message #Bob".
            channel.type === 'dm' ? `Message ${label}` : `Message #${label}`
          }
          users={users}
          onSend={send}
        />
        <AiActionBar
          mode="channel"
          channelId={channel.id}
          users={users}
          messages={messages}
          onOpenAiSettings={onOpenAiSettings}
        />
      </div>
    </main>
  );
};

export default ChatWindow;
