import React from 'react';
import Modal from './Modal';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  children: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: 'primary' | 'danger';
}

const ConfirmationModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  children,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'primary',
}) => (
  <Modal
    isOpen={isOpen}
    onClose={onClose}
    title={title}
    size="sm"
    footer={
      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-line px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-hover"
        >
          {cancelText}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          data-autofocus
          className={`rounded-md px-4 py-2 text-sm font-semibold text-white transition-colors ${
            variant === 'danger'
              ? 'bg-danger hover:bg-danger-hover'
              : 'bg-accent hover:bg-accent-hover'
          }`}
        >
          {confirmText}
        </button>
      </div>
    }
  >
    <div className="text-sm text-ink">{children}</div>
  </Modal>
);

export default ConfirmationModal;
