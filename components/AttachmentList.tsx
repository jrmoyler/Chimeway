import React from 'react';
import type { Attachment } from '../types';
import { useAttachmentUrl } from '../hooks/useAttachmentUrl';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const AttachmentItem: React.FC<{ attachment: Attachment }> = ({ attachment }) => {
  const url = useAttachmentUrl(attachment.storagePath);
  const isImage = attachment.mimeType.startsWith('image/');

  if (!url) {
    return (
      <div className="rounded-md border border-line bg-sunken px-3 py-2 text-xs text-ink-muted">
        Loading {attachment.name}…
      </div>
    );
  }

  if (isImage) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="block w-fit">
        <img
          src={url}
          alt={attachment.name}
          className="max-h-64 rounded-md border border-line object-contain"
        />
        <span className="mt-1 block text-xs text-ink-muted">
          {attachment.name} · {formatSize(attachment.size)}
        </span>
      </a>
    );
  }

  return (
    <a
      href={url}
      download={attachment.name}
      className="flex w-fit items-center gap-2 rounded-md border border-line bg-sunken px-3 py-2 text-sm text-ink transition-colors hover:bg-hover"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-4 w-4 shrink-0 text-ink-muted"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
      </svg>
      <span className="truncate">{attachment.name}</span>
      <span className="shrink-0 text-xs text-ink-muted">{formatSize(attachment.size)}</span>
    </a>
  );
};

const AttachmentList: React.FC<{ attachments: Attachment[] }> = ({ attachments }) => {
  if (attachments.length === 0) return null;

  return (
    <ul className="mt-2 flex flex-col gap-2">
      {attachments.map((attachment) => (
        <li key={attachment.id}>
          <AttachmentItem attachment={attachment} />
        </li>
      ))}
    </ul>
  );
};

export default AttachmentList;
