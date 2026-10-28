import React, { useCallback, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * Accessible dialog.
 *
 * The previous implementation had none of the following, which affected all
 * six dialogs in the app:
 *   - Escape to close
 *   - a focus trap, initial focus, and focus restoration on close
 *   - `role="dialog"` / `aria-modal` / an accessible name
 *   - background scroll locking
 *   - a backdrop press that ignores drags starting inside the panel
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Visibility test for focus-trap candidates.
 *
 * Deliberately not `offsetParent !== null`: that is null for any
 * position: fixed element (this dialog is inside a fixed overlay) and is not
 * implemented by jsdom, so it silently collapsed the trap to a single element.
 */
function isVisible(el: HTMLElement): boolean {
  if (el.hidden) return false;
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

export type ModalSize = 'sm' | 'md' | 'lg';

const SIZE_CLASS: Record<ModalSize, string> = {
  sm: 'max-w-md',
  md: 'max-w-2xl',
  lg: 'max-w-4xl',
};

interface Props {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: ModalSize;
  /** Hide the default header; the content supplies its own chrome. */
  bare?: boolean;
  footer?: React.ReactNode;
}

const Modal: React.FC<Props> = ({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
  bare = false,
  footer,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  // Tracks where a pointer press began, so a drag that starts on the panel and
  // releases on the backdrop does not close the dialog.
  const pressStartedOnBackdrop = useRef(false);
  const titleId = useId();

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;

      const panel = panelRef.current;
      if (!panel) return;

      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        isVisible,
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;

      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  // Lock background scroll while open.
  useEffect(() => {
    if (!isOpen) return;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [isOpen]);

  // Move focus into the dialog, and restore it to the trigger on close.
  useEffect(() => {
    if (!isOpen) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const panel = panelRef.current;
    const target =
      panel?.querySelector<HTMLElement>('[data-autofocus]') ??
      panel?.querySelector<HTMLElement>(FOCUSABLE) ??
      panel;
    target?.focus();

    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center"
      onPointerDown={(event) => {
        pressStartedOnBackdrop.current = event.target === event.currentTarget;
      }}
      onPointerUp={(event) => {
        if (pressStartedOnBackdrop.current && event.target === event.currentTarget) onClose();
        pressStartedOnBackdrop.current = false;
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={`w-full ${SIZE_CLASS[size]} my-auto overflow-hidden rounded-xl border border-line bg-raised shadow-2xl outline-none`}
      >
        {bare ? (
          <h2 id={titleId} className="sr-only">
            {title}
          </h2>
        ) : (
          <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
            <h2 id={titleId} className="text-lg font-semibold text-ink">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
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
        )}

        <div className="max-h-[70vh] overflow-y-auto px-5 py-5">{children}</div>

        {footer ? <footer className="border-t border-line px-5 py-4">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
};

export default Modal;
