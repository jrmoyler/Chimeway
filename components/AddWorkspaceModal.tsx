import React, { useState } from 'react';
import Modal from './ui/Modal';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string) => void;
}

/*
 * The stateful body is mounted only while the dialog is open, so its fields
 * start empty every time. The previous approach - resetting state from an
 * effect keyed on `isOpen` - caused a render with stale values first.
 */
const AddWorkspaceModalBody: React.FC<Omit<Props, 'isOpen'>> = ({ onClose, onCreate }) => {
  const [name, setName] = useState('');

  const canCreate = name.trim().length > 0;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canCreate) return;
    onCreate(name.trim());
    onClose();
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Create a workspace"
      size="sm"
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
            form="create-workspace-form"
            disabled={!canCreate}
            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            Create workspace
          </button>
        </div>
      }
    >
      <form id="create-workspace-form" onSubmit={submit}>
        <label htmlFor="workspace-name" className="block text-sm font-medium text-ink">
          Workspace name
        </label>
        <input
          id="workspace-name"
          data-autofocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Acme Corporation"
          className="mt-1.5 block w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none"
        />
        <p className="mt-2 text-xs text-ink-subtle">
          A <span className="font-medium text-ink-muted">#general</span> channel is created
          automatically. You can rename the workspace later.
        </p>
      </form>
    </Modal>
  );
};

const AddWorkspaceModal: React.FC<Props> = ({ isOpen, ...rest }) =>
  isOpen ? <AddWorkspaceModalBody {...rest} /> : null;

export default AddWorkspaceModal;
