import { useCallback, useEffect, useLayoutEffect, type RefObject } from 'react';

/**
 * Grows a textarea to fit its content, up to a maximum.
 *
 * Measures in a layout effect so the height is correct before paint, and
 * re-measures through a ResizeObserver. The observer matters because the
 * first measurement can happen before stylesheets have applied (and because
 * the available width changes when the sidebar or thread panel opens) - a
 * one-shot measurement can otherwise latch onto a wrong value and never
 * correct itself.
 */
export function useAutosizeTextarea(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  maxHeight: number,
): void {
  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const next = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [ref, maxHeight]);

  useLayoutEffect(resize, [value, resize]);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;

    let lastWidth = el.clientWidth;
    const observer = new ResizeObserver(() => {
      const width = el.clientWidth;
      // Only react to width changes; reacting to height would loop.
      if (width !== lastWidth) {
        lastWidth = width;
        resize();
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, resize]);
}
