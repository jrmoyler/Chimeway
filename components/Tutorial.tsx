import React from 'react';
import Modal from './ui/Modal';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Onboarding copy.
 *
 * Rewritten to describe what the app actually does. The original advertised
 * "real-time messaging" and told people to reply in threads - a feature that
 * had no input field - while the Tutorial itself was the only place that
 * admitted the data was mocked.
 */
const Tutorial: React.FC<Props> = ({ isOpen, onClose }) => (
  <Modal
    isOpen={isOpen}
    onClose={onClose}
    title="Welcome to Chimeway"
    size="md"
    footer={
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onClose}
          data-autofocus
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
        >
          Start exploring
        </button>
      </div>
    }
  >
    <div className="space-y-5 text-sm text-ink">
      <p className="text-ink-muted">
        Chimeway is a team messaging workspace. Here is what you can do.
      </p>

      <section>
        <h3 className="font-semibold text-ink">Conversations</h3>
        <ul className="mt-1.5 list-disc space-y-1 pl-5 text-ink-muted">
          <li>
            Send messages in any channel or DM. Markdown works — <code>**bold**</code>,{' '}
            <code>`code`</code>, lists and links.
          </li>
          <li>
            Type <strong>@</strong> to mention someone. Mentions of you are highlighted, and
            conversations that mention you get a red badge.
          </li>
          <li>Attach files up to 5 MB. Images preview inline.</li>
          <li>Hover a message to react, reply in a thread, or edit and delete your own.</li>
        </ul>
      </section>

      <section>
        <h3 className="font-semibold text-ink">Threads</h3>
        <p className="mt-1.5 text-ink-muted">
          Open a thread from any message to reply without cluttering the channel. Replies support
          the same editing, reactions and attachments as top-level messages.
        </p>
      </section>

      <section>
        <h3 className="font-semibold text-ink">AI summaries</h3>
        <p className="mt-1.5 text-ink-muted">
          Recap a channel or summarise an open thread with Gemini. Connect your own API key in{' '}
          <strong>Settings → AI</strong> first; it is stored only in this browser.
        </p>
      </section>

      <section>
        <h3 className="font-semibold text-ink">What this build is</h3>
        <p className="mt-1.5 text-ink-muted">
          Chimeway runs entirely in your browser. Your messages, channels and workspaces are saved
          locally and survive a refresh, but they stay on this device — there are no accounts yet,
          and other people cannot see what you write here. The other members are sample data.
        </p>
      </section>
    </div>
  </Modal>
);

export default Tutorial;
