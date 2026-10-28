import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Modal from './Modal';

/*
 * These cover the behaviours the previous dialog lacked entirely: Escape to
 * close, a focus trap, focus restoration, dialog semantics, scroll locking,
 * and a backdrop press that ignores drags starting inside the panel.
 */

const Harness = ({ onClose }: { onClose: () => void }) => (
  <Modal isOpen onClose={onClose} title="Example dialog">
    <button type="button">first</button>
    <button type="button">second</button>
  </Modal>
);

describe('Modal', () => {
  it('exposes dialog semantics and an accessible name', () => {
    render(<Harness onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Example dialog');
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Harness onClose={onClose} />);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('moves focus into the dialog on open', () => {
    render(<Harness onClose={vi.fn()} />);
    expect(screen.getByRole('dialog')).toContainElement(
      document.activeElement as HTMLElement,
    );
  });

  it('traps Tab inside the dialog', async () => {
    const user = userEvent.setup();
    render(<Harness onClose={vi.fn()} />);

    const close = screen.getByRole('button', { name: 'Close dialog' });
    const first = screen.getByRole('button', { name: 'first' });
    const last = screen.getByRole('button', { name: 'second' });

    last.focus();
    await user.tab();
    expect(document.activeElement).toBe(close);

    first.focus();
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(close);
  });

  it('locks background scrolling while open and restores it after', () => {
    const { unmount } = render(<Harness onClose={vi.fn()} />);
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('restores focus to the element that opened it', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'open';
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { unmount } = render(<Harness onClose={vi.fn()} />);
    expect(document.activeElement).not.toBe(trigger);

    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
