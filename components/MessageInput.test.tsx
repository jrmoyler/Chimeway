import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MessageInput from './MessageInput';
import type { User } from '../types';

const users: User[] = [
  {
    id: 'u1',
    name: 'Alice Nakamura',
    displayName: 'alice',
    title: 'Engineer',
    avatar: '',
    status: 'active',
  },
  {
    id: 'u2',
    name: 'Bob Okafor',
    displayName: 'bob',
    title: 'Engineer',
    avatar: '',
    status: 'active',
  },
];

const setup = () => {
  const onSend = vi.fn();
  render(
    <MessageInput draftKey="c1" placeholder="Message #general" users={users} onSend={onSend} />,
  );
  return { onSend, user: userEvent.setup() };
};

describe('MessageInput', () => {
  it('sends on Enter and clears the composer', async () => {
    const { onSend, user } = setup();
    const box = screen.getByRole('textbox');

    await user.click(box);
    await user.keyboard('hello there{Enter}');

    expect(onSend).toHaveBeenCalledWith('hello there', []);
    expect(box).toHaveValue('');
  });

  it('inserts a newline on Shift+Enter instead of sending', async () => {
    const { onSend, user } = setup();
    const box = screen.getByRole('textbox');

    await user.click(box);
    await user.keyboard('line one{Shift>}{Enter}{/Shift}line two');

    expect(onSend).not.toHaveBeenCalled();
    expect(box).toHaveValue('line one\nline two');
  });

  it('refuses to send a whitespace-only message', async () => {
    const { onSend, user } = setup();
    await user.click(screen.getByRole('textbox'));
    await user.keyboard('   {Enter}');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('disables Send until there is something to send', async () => {
    const { user } = setup();
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toBeDisabled();

    await user.click(screen.getByRole('textbox'));
    await user.keyboard('x');
    expect(send).toBeEnabled();
  });

  // Regression: the @ button used to be decorative with no handler at all.
  it('offers mention completion and inserts the handle', async () => {
    const { onSend, user } = setup();
    const box = screen.getByRole('textbox');

    await user.click(box);
    await user.keyboard('hey @bo');

    const option = await screen.findByRole('option', { name: /bob/i });
    await user.click(option);

    expect(box).toHaveValue('hey @bob ');

    await user.keyboard('{Enter}');
    expect(onSend).toHaveBeenCalledWith('hey @bob', []);
  });

  it('closes the mention list on Escape without sending', async () => {
    const { onSend, user } = setup();
    await user.click(screen.getByRole('textbox'));
    await user.keyboard('hey @al');
    expect(screen.getByRole('listbox')).toBeTruthy();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('labels the attachment and mention controls for assistive tech', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Attach a file' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mention someone' })).toBeTruthy();
  });
});
