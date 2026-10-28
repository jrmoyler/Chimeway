import React, { useRef, useState } from 'react';
import type { Message, User } from '../types';
import { ApiError, requestAiSummary } from '../data/api';
import Modal from './ui/Modal';
import MessageText from './MessageText';
import { SparklesIcon } from './icons/SparklesIcon';

type Mode = 'channel' | 'thread';

interface Props {
  mode: Mode;
  channelId: string;
  users: User[];
  /** Channel mode: used only to decide whether there is anything to recap. */
  messages?: Message[];
  /** Thread mode: the specific thread being viewed. */
  rootMessage?: Message;
  onOpenAiSettings?: () => void;
}

/**
 * AI entry points.
 *
 * Two fixes over the original:
 *  - Thread summaries now summarise the thread that is actually open. The old
 *    code did `channel.messages.find(m => m.thread?.length)` and summarised
 *    whichever message happened to have replies.
 *  - Failures surface as errors rather than being returned as prose and
 *    rendered as if the model had said them.
 */
const AiActionBar: React.FC<Props> = ({
  mode,
  channelId,
  users,
  messages = [],
  rootMessage,
  onOpenAiSettings,
}) => {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [overQuota, setOverQuota] = useState(false);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const run = async (nextTitle: string, task: (signal: AbortSignal) => Promise<string>) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setTitle(nextTitle);
    setContent('');
    setError(null);
    setOverQuota(false);
    setLoading(true);
    setOpen(true);

    try {
      const result = await task(controller.signal);
      if (!controller.signal.aborted) setContent(result);
    } catch (err) {
      if (controller.signal.aborted) return;
      if (err instanceof ApiError && err.code === '429') setOverQuota(true);
      setError(err instanceof Error ? err.message : 'The AI request failed.');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  const close = () => {
    abortRef.current?.abort();
    setOpen(false);
    setLoading(false);
  };

  const handleRecap = () =>
    run('Channel recap', (signal) =>
      requestAiSummary({ mode: 'channel_recap', channelId, signal }),
    );

  const handleSummarise = () => {
    if (!rootMessage) return;
    return run('Thread summary', (signal) =>
      requestAiSummary({
        mode: 'thread_summary',
        channelId,
        rootMessageId: rootMessage.id,
        signal,
      }),
    );
  };

  const canRecap = mode === 'channel' && messages.length > 0;
  const canSummarise = mode === 'thread' && Boolean(rootMessage);

  return (
    <div className="mt-1.5 flex items-center justify-end gap-2 text-xs text-ink-subtle">
      <SparklesIcon className="h-3.5 w-3.5 text-accent" aria-hidden="true" />

      {mode === 'channel' ? (
        <button
          type="button"
          onClick={handleRecap}
          disabled={loading || !canRecap}
          title={canRecap ? 'Summarise recent activity in this channel' : 'No messages to recap yet'}
          className="rounded px-1 py-0.5 font-medium transition-colors hover:text-ink hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
        >
          Recap channel
        </button>
      ) : (
        <button
          type="button"
          onClick={handleSummarise}
          disabled={loading || !canSummarise}
          title="Summarise this thread"
          className="rounded px-1 py-0.5 font-medium transition-colors hover:text-ink hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
        >
          Summarise thread
        </button>
      )}

      <Modal isOpen={open} onClose={close} title={title} size="md">
        {loading ? (
          <div
            className="flex flex-col items-center justify-center gap-3 py-10"
            role="status"
            aria-live="polite"
          >
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-accent" />
            <span className="text-sm text-ink-muted">
              {mode === 'thread' ? 'Summarising the thread…' : 'Reading recent messages…'}
            </span>
          </div>
        ) : error ? (
          <div role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-4">
            <p className="text-sm font-medium text-danger">{error}</p>
            {overQuota && onOpenAiSettings && (
              <button
                type="button"
                onClick={() => {
                  close();
                  onOpenAiSettings();
                }}
                className="mt-3 rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
              >
                See your AI usage
              </button>
            )}
          </div>
        ) : (
          <MessageText text={content} users={users} currentUser={undefined} />
        )}
      </Modal>
    </div>
  );
};

export default AiActionBar;
