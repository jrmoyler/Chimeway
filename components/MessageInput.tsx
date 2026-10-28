import React, { useMemo, useRef, useState } from 'react';
import type { User } from '../types';
import { createId } from '../lib/ids';
import { useAutosizeTextarea } from '../hooks/useAutosizeTextarea';
import { MAX_ATTACHMENT_BYTES, MAX_MESSAGE_LENGTH } from '../lib/limits';
import { PlusIcon } from './icons/PlusIcon';
import { AtIcon } from './icons/AtIcon';
import Avatar from './ui/Avatar';

const MAX_TEXTAREA_HEIGHT = 240;

/**
 * A file chosen but not yet uploaded.
 *
 * Uploads happen after the message row exists, because the storage object key
 * is scoped to the channel and the attachment row references the message id.
 * Holding the File here keeps the composer responsive and means abandoning a
 * draft leaves nothing behind in storage.
 */
interface PendingFile {
  id: string;
  file: File;
  name: string;
  size: number;
  error?: string;
}

interface Props {
  placeholder: string;
  users: User[];
  /**
   * Identifies the conversation. Call sites pass it as a React `key` too, so
   * switching conversations mounts a fresh composer rather than needing an
   * effect to clear the previous draft.
   */
  draftKey: string;
  onSend: (text: string, files: File[]) => void;
  autoFocus?: boolean;
}

const MessageInput: React.FC<Props> = ({ placeholder, users, draftKey, onSend, autoFocus }) => {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<PendingFile[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-grow. The original was rows={1} with resize-none and no growth, so
  // multi-line messages were composed through a one-line slit.
  useAutosizeTextarea(textareaRef, text, MAX_TEXTAREA_HEIGHT);

  const mentionMatches = useMemo(() => {
    if (mentionQuery === null) return [];
    const needle = mentionQuery.toLowerCase();
    return users
      .filter(
        (u) =>
          u.displayName.toLowerCase().startsWith(needle) ||
          u.name.toLowerCase().includes(needle),
      )
      .slice(0, 6);
  }, [mentionQuery, users]);

  const updateMentionState = (value: string, caret: number) => {
    const upToCaret = value.slice(0, caret);
    const match = /(?:^|\s)@([a-z0-9._-]*)$/i.exec(upToCaret);
    setMentionQuery(match ? (match[1] ?? '') : null);
    setMentionIndex(0);
  };

  const insertMention = (user: User) => {
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? text.length;
    const upToCaret = text.slice(0, caret);
    const match = /(?:^|\s)@([a-z0-9._-]*)$/i.exec(upToCaret);
    if (!match) return;

    const start = caret - (match[1]?.length ?? 0) - 1;
    const next = `${text.slice(0, start)}@${user.displayName} ${text.slice(caret)}`;
    setText(next);
    setMentionQuery(null);

    queueMicrotask(() => {
      const caretAfter = start + user.displayName.length + 2;
      el?.focus();
      el?.setSelectionRange(caretAfter, caretAfter);
    });
  };

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList?.length) return;

    const accepted: PendingFile[] = Array.from(fileList).map((file) => ({
      id: createId('att'),
      file,
      name: file.name,
      size: file.size,
      ...(file.size > MAX_ATTACHMENT_BYTES ? { error: 'Larger than the 5 MB limit' } : {}),
    }));

    setAttachments((current) => [...current, ...accepted]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const validAttachments = attachments.filter((a) => !a.error);
  const canSend = (text.trim().length > 0 || validAttachments.length > 0) && text.length <= MAX_MESSAGE_LENGTH;

  const submit = () => {
    if (!canSend) return;
    onSend(
      text.trim(),
      validAttachments.map((pending) => pending.file),
    );
    setText('');
    setAttachments([]);
    setMentionQuery(null);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery !== null && mentionMatches.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setMentionIndex((i) => (i + 1) % mentionMatches.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setMentionIndex((i) => (i - 1 + mentionMatches.length) % mentionMatches.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const picked = mentionMatches[mentionIndex];
        if (picked) {
          event.preventDefault();
          insertMention(picked);
          return;
        }
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setMentionQuery(null);
        return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  const overLimit = text.length > MAX_MESSAGE_LENGTH;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="relative"
    >
      {mentionQuery !== null && mentionMatches.length > 0 && (
        <ul
          role="listbox"
          aria-label="Mention a person"
          className="absolute bottom-full z-20 mb-2 w-72 overflow-hidden rounded-lg border border-line bg-raised shadow-xl"
        >
          {mentionMatches.map((user, index) => (
            <li key={user.id}>
              <button
                type="button"
                role="option"
                aria-selected={index === mentionIndex}
                onMouseEnter={() => setMentionIndex(index)}
                onClick={() => insertMention(user)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                  index === mentionIndex ? 'bg-accent text-white' : 'text-ink hover:bg-hover'
                }`}
              >
                <Avatar user={user} size={22} rounded="full" />
                <span className="font-medium">{user.displayName}</span>
                <span className={index === mentionIndex ? 'text-white/75' : 'text-ink-subtle'}>
                  {user.name}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="rounded-lg border border-line bg-surface focus-within:border-accent">
        <label htmlFor={`composer-${draftKey}`} className="sr-only">
          {placeholder}
        </label>
        <textarea
          id={`composer-${draftKey}`}
          ref={textareaRef}
          value={text}
          autoFocus={autoFocus}
          onChange={(event) => {
            setText(event.target.value);
            updateMentionState(event.target.value, event.target.selectionStart);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          className="block w-full resize-none bg-transparent px-3 py-2.5 text-ink placeholder:text-ink-subtle focus:outline-none"
        />

        {attachments.length > 0 && (
          <ul className="flex flex-wrap gap-2 px-3 pb-2">
            {attachments.map((attachment) => (
              <li
                key={attachment.id}
                className={`flex items-center gap-2 rounded-md border px-2 py-1 text-xs ${
                  attachment.error
                    ? 'border-danger/50 bg-danger/10 text-danger'
                    : 'border-line bg-sunken text-ink-muted'
                }`}
              >
                <span className="max-w-48 truncate">{attachment.name}</span>
                {attachment.error && <span>— {attachment.error}</span>}
                <button
                  type="button"
                  onClick={() =>
                    setAttachments((current) => current.filter((a) => a.id !== attachment.id))
                  }
                  aria-label={`Remove ${attachment.name}`}
                  className="rounded p-0.5 transition-colors hover:bg-hover"
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    className="h-3 w-3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.5}
                    strokeLinecap="round"
                  >
                    <path d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center justify-between gap-2 px-2 pb-2">
          <div className="flex items-center gap-0.5">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => handleFiles(event.target.files)}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Attach a file"
              title="Attach a file"
              className="rounded p-1.5 text-ink-muted transition-colors hover:bg-hover hover:text-ink"
            >
              <PlusIcon className="h-5 w-5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => {
                const el = textareaRef.current;
                const caret = el?.selectionStart ?? text.length;
                const needsSpace = caret > 0 && !/\s$/.test(text.slice(0, caret));
                const next = `${text.slice(0, caret)}${needsSpace ? ' ' : ''}@${text.slice(caret)}`;
                setText(next);
                queueMicrotask(() => {
                  const at = caret + (needsSpace ? 2 : 1);
                  el?.focus();
                  el?.setSelectionRange(at, at);
                  updateMentionState(next, at);
                });
              }}
              aria-label="Mention someone"
              title="Mention someone"
              className="rounded p-1.5 text-ink-muted transition-colors hover:bg-hover hover:text-ink"
            >
              <AtIcon className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          <div className="flex items-center gap-3">
            {text.length > MAX_MESSAGE_LENGTH * 0.9 && (
              <span className={`text-xs tabular-nums ${overLimit ? 'text-danger' : 'text-ink-subtle'}`}>
                {text.length}/{MAX_MESSAGE_LENGTH}
              </span>
            )}
            <button
              type="submit"
              disabled={!canSend}
              className="rounded-md bg-accent px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </form>
  );
};

export default MessageInput;
