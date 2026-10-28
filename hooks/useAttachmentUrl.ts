import { useEffect, useState } from 'react';
import { signedAttachmentUrl } from '../data/api';

/**
 * Resolves an attachment to a short-lived signed URL.
 *
 * The bucket is private, so there is no permanent public link: each view mints
 * a URL that expires. Results are cached per path for the page's lifetime, so
 * re-rendering a message does not mint a new URL each time.
 */
const cache = new Map<string, string>();

interface Resolved {
  path: string;
  url: string | null;
}

export function useAttachmentUrl(storagePath: string): string | null {
  const [resolved, setResolved] = useState<Resolved>(() => ({
    path: storagePath,
    url: cache.get(storagePath) ?? null,
  }));

  // Reconciled during render rather than synced by an effect, so switching to
  // a different attachment never shows the previous one's URL for a frame.
  const url =
    resolved.path === storagePath ? resolved.url : (cache.get(storagePath) ?? null);

  useEffect(() => {
    if (cache.has(storagePath)) return;

    let cancelled = false;
    void signedAttachmentUrl(storagePath).then((signed) => {
      if (cancelled || !signed) return;
      cache.set(storagePath, signed);
      setResolved({ path: storagePath, url: signed });
    });

    return () => {
      cancelled = true;
    };
  }, [storagePath]);

  return url;
}
