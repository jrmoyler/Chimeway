import React, { useState } from 'react';
import { normaliseChannelName } from '../lib/channelName';
import Modal from './ui/Modal';
import { HashIcon } from './icons/HashIcon';
import { LockIcon } from './icons/LockIcon';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  existingNames: string[];
  onCreate: (name: string, type: 'public' | 'private', description: string) => void;
}

const CreateChannelModalBody: React.FC<Omit<Props, 'isOpen'>> = ({
  onClose,
  existingNames,
  onCreate,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<'public' | 'private'>('public');

  const normalised = normaliseChannelName(name);
  const duplicate = normalised.length > 0 && existingNames.includes(normalised);
  const error = duplicate ? 'A channel with that name already exists.' : null;
  const canCreate = normalised.length > 0 && !duplicate;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canCreate) return;
    onCreate(normalised, type, description);
    onClose();
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Create a channel"
      size="md"
      footer={
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-line px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-hover"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="create-channel-form"
            disabled={!canCreate}
            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            Create
          </button>
        </div>
      }
    >
      <form id="create-channel-form" onSubmit={submit} className="space-y-5">
        <div>
          <label htmlFor="channel-name" className="block text-sm font-medium text-ink">
            Name
          </label>
          <div className="relative mt-1.5">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-subtle"
            >
              #
            </span>
            <input
              id="channel-name"
              data-autofocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="plan-budget"
              aria-invalid={Boolean(error)}
              aria-describedby="channel-name-hint"
              className={`block w-full rounded-md border bg-surface py-2 pl-7 pr-3 text-sm text-ink placeholder:text-ink-subtle focus:outline-none ${
                error ? 'border-danger focus:border-danger' : 'border-line focus:border-accent'
              }`}
            />
          </div>
          <p id="channel-name-hint" className="mt-1.5 text-xs text-ink-subtle">
            {error ? (
              <span className="text-danger">{error}</span>
            ) : normalised && normalised !== name.trim().toLowerCase() ? (
              <>
                Will be created as <span className="font-medium text-ink">#{normalised}</span>
              </>
            ) : (
              'Lowercase letters, numbers and dashes. Spaces become dashes.'
            )}
          </p>
        </div>

        <div>
          <label htmlFor="channel-description" className="block text-sm font-medium text-ink">
            Description <span className="font-normal text-ink-subtle">(optional)</span>
          </label>
          <textarea
            id="channel-description"
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What is this channel about?"
            className="mt-1.5 block w-full resize-y rounded-md border border-line bg-surface p-2.5 text-sm text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none"
          />
        </div>

        <fieldset>
          <legend className="text-sm font-medium text-ink">Visibility</legend>
          <div className="mt-2 space-y-2">
            {(
              [
                {
                  value: 'public' as const,
                  icon: <HashIcon className="h-4 w-4" aria-hidden="true" />,
                  label: 'Public',
                  hint: 'Anyone in the workspace can find and join.',
                },
                {
                  value: 'private' as const,
                  icon: <LockIcon className="h-4 w-4" aria-hidden="true" />,
                  label: 'Private',
                  hint: 'Only invited people can see this channel.',
                },
              ]
            ).map((option) => (
              <label
                key={option.value}
                className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors ${
                  type === option.value ? 'border-accent bg-accent/5' : 'border-line hover:bg-hover'
                }`}
              >
                <input
                  type="radio"
                  name="visibility"
                  value={option.value}
                  checked={type === option.value}
                  onChange={() => setType(option.value)}
                  className="mt-0.5 h-4 w-4 accent-[var(--app-accent)]"
                />
                <span>
                  <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                    {option.icon}
                    {option.label}
                  </span>
                  <span className="mt-0.5 block text-sm text-ink-muted">{option.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </form>
    </Modal>
  );
};

const CreateChannelModal: React.FC<Props> = ({ isOpen, ...rest }) =>
  isOpen ? <CreateChannelModalBody {...rest} /> : null;

export default CreateChannelModal;
