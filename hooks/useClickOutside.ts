import { useEffect, type RefObject } from 'react';

/**
 * Calls `onOutside` when a pointer press lands outside every supplied element.
 *
 * Uses `pointerdown` rather than `click` so a text selection that starts
 * inside and ends outside does not count as an outside press - the bug that
 * made the old modal close and discard input mid-drag.
 */
export function useClickOutside(
  refs: Array<RefObject<HTMLElement | null>>,
  onOutside: () => void,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) return;

    const handler = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      const inside = refs.some((ref) => ref.current?.contains(target));
      if (!inside) onOutside();
    };

    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [refs, onOutside, enabled]);
}
