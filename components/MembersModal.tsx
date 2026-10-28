import React from 'react';
import type { Channel } from '../types';
import { channelLabel, channelMembers } from '../store/selectors';
import { useStore } from '../store/StoreProvider';
import Modal from './ui/Modal';
import Avatar from './ui/Avatar';
import { STATUS_LABEL } from './ui/UserStatusIndicator';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  channel: Channel;
}

const MembersModal: React.FC<Props> = ({ isOpen, onClose, channel }) => {
  const { state } = useStore();
  const members = channelMembers(state, channel);
  const label = channelLabel(state, channel);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={channel.type === 'dm' ? `People in ${label}` : `Members of #${label}`}
      size="sm"
    >
      <ul className="space-y-1">
        {members.map((member) => (
          <li key={member.id} className="flex items-center gap-3 rounded-md px-2 py-2">
            <Avatar user={member} size={36} rounded="full" showStatus />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">
                {member.name}
                {member.id === state.currentUserId && (
                  <span className="ml-1.5 text-xs font-normal text-ink-subtle">(you)</span>
                )}
              </p>
              <p className="truncate text-xs text-ink-subtle">
                @{member.displayName} · {member.title} · {STATUS_LABEL[member.status]}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </Modal>
  );
};

export default MembersModal;
