import React, { Fragment, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import type { User } from '../types';

/**
 * Renders message markdown, highlighting @mentions of known users.
 *
 * Raw HTML is not enabled in react-markdown, and link URLs go through its
 * default transform, so user-authored text cannot inject markup or
 * `javascript:` URLs.
 */

const MENTION_PATTERN = /(@[a-z0-9._-]+)/gi;

function highlightMentions(node: ReactNode, mentionable: Set<string>, meHandle: string): ReactNode {
  if (typeof node === 'string') {
    const parts = node.split(MENTION_PATTERN);
    if (parts.length === 1) return node;

    return parts.map((part, index) => {
      if (!part.startsWith('@')) return <Fragment key={index}>{part}</Fragment>;

      const handle = part.slice(1).toLowerCase();
      if (!mentionable.has(handle)) return <Fragment key={index}>{part}</Fragment>;

      const isMe = handle === meHandle;
      return (
        <span
          key={index}
          className={`rounded px-1 py-0.5 font-medium ${
            isMe ? 'bg-accent text-white' : 'bg-accent/15 text-accent'
          }`}
        >
          {part}
        </span>
      );
    });
  }

  if (Array.isArray(node)) {
    return node.map((child, index) => (
      <Fragment key={index}>{highlightMentions(child, mentionable, meHandle)}</Fragment>
    ));
  }

  return node;
}

interface Props {
  text: string;
  users: User[];
  currentUser: User | undefined;
  className?: string;
}

const MessageText: React.FC<Props> = ({ text, users, currentUser, className = '' }) => {
  const mentionable = new Set(users.map((u) => u.displayName.toLowerCase()));
  const meHandle = currentUser?.displayName.toLowerCase() ?? '';

  const wrap = (children: ReactNode) => highlightMentions(children, mentionable, meHandle);

  return (
    <div
      className={`prose prose-sm max-w-none break-words dark:prose-invert prose-p:my-1 prose-pre:my-2 prose-pre:bg-sunken prose-headings:mt-3 prose-headings:mb-1 ${className}`}
    >
      <ReactMarkdown
        components={{
          p: ({ children }) => <p>{wrap(children)}</p>,
          li: ({ children }) => <li>{wrap(children)}</li>,
          strong: ({ children }) => <strong>{wrap(children)}</strong>,
          em: ({ children }) => <em>{wrap(children)}</em>,
          a: ({ children, href }) =>
            // react-markdown strips unsafe URLs (javascript:, data:) down to an
            // empty href. An empty href still navigates to the current page,
            // reloading the app, so render those as plain text instead.
            href ? (
              <a href={href} target="_blank" rel="noopener noreferrer nofollow">
                {children}
              </a>
            ) : (
              <>{children}</>
            ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
};

export default MessageText;
