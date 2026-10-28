import React, { useEffect, useState } from 'react';
import type { NotificationPrefs, ThemePreference, User } from '../types';
import { useStore } from '../store/StoreProvider';
import { countRecentAiRequests, signOut } from '../data/api';
import Modal from './ui/Modal';
import ConfirmationModal from './ui/ConfirmationModal';
import Avatar from './ui/Avatar';
import { UserIcon } from './icons/UserIcon';
import { SettingsIcon } from './icons/SettingsIcon';
import { SparklesIcon } from './icons/SparklesIcon';
import { BellIcon } from './icons/BellIcon';
import { PaletteIcon } from './icons/PaletteIcon';
import type { SettingsTab } from './UserProfileDropdown';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  activeTab: SettingsTab;
  onChangeTab: (tab: SettingsTab) => void;
  currentUser: User;
  theme: ThemePreference;
  onChangeTheme: (theme: ThemePreference) => void;
}

const Toggle: React.FC<{
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description: string;
}> = ({ checked, onChange, label, description }) => (
  <label className="flex cursor-pointer items-start justify-between gap-4 py-2">
    <span className="min-w-0">
      <span className="block text-sm font-medium text-ink">{label}</span>
      <span className="block text-sm text-ink-muted">{description}</span>
    </span>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
        checked ? 'bg-accent' : 'bg-sunken ring-1 ring-line'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  </label>
);

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode; htmlFor: string }> = ({
  label,
  hint,
  children,
  htmlFor,
}) => (
  <div className="grid gap-1.5 sm:grid-cols-3 sm:items-start sm:gap-4">
    <label htmlFor={htmlFor} className="pt-2 text-sm font-medium text-ink-muted">
      {label}
    </label>
    <div className="sm:col-span-2">
      {children}
      {hint && <p className="mt-1 text-xs text-ink-subtle">{hint}</p>}
    </div>
  </div>
);

const inputClass =
  'block w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none';

const SettingsModalBody: React.FC<Omit<Props, 'isOpen'>> = ({
  onClose,
  activeTab,
  onChangeTab,
  currentUser,
  theme,
  onChangeTheme,
}) => {
  const { state, actions } = useStore();

  // Profile draft. The original used uncontrolled `defaultValue` inputs that
  // nothing read, so edits were silently discarded.
  const [name, setName] = useState(currentUser.name);
  const [displayName, setDisplayName] = useState(currentUser.displayName);
  const [title, setTitle] = useState(currentUser.title);
  const [avatar, setAvatar] = useState(currentUser.avatar);
  const [saved, setSaved] = useState(false);

  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [aiUsage, setAiUsage] = useState<number | null>(null);

  useEffect(() => {
    if (activeTab !== 'ai') return;
    let cancelled = false;
    void countRecentAiRequests().then((count) => {
      if (!cancelled) setAiUsage(count);
    });
    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  const dirty =
    name !== currentUser.name ||
    displayName !== currentUser.displayName ||
    title !== currentUser.title ||
    avatar !== currentUser.avatar;

  const saveProfile = () => {
    const nextName = name.trim() || currentUser.name;
    // replaceAll, not replace - the original stripped only the first space.
    const nextHandle = (displayName.trim() || currentUser.displayName)
      .toLowerCase()
      .replaceAll(/\s+/g, '');
    const nextTitle = title.trim();
    const nextAvatar = avatar.trim();

    void actions.updateProfile({
      name: nextName,
      displayName: nextHandle,
      title: nextTitle,
      avatar: nextAvatar,
    });

    // Show what was actually stored, so a normalised handle is not left
    // looking like the raw text the user typed.
    setName(nextName);
    setDisplayName(nextHandle);
    setTitle(nextTitle);
    setAvatar(nextAvatar);
    setSaved(true);
  };

  const setPrefs = (patch: Partial<NotificationPrefs>) =>
    actions.setNotificationPrefs({ ...state.notificationPrefs, ...patch });

  const handlePickAvatar = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setAvatar(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const tabs: Array<{ id: SettingsTab; label: string; icon: React.ReactNode }> = [
    { id: 'profile', label: 'Profile', icon: <UserIcon className="h-5 w-5" aria-hidden="true" /> },
    {
      id: 'preferences',
      label: 'Preferences',
      icon: <SettingsIcon className="h-5 w-5" aria-hidden="true" />,
    },
    { id: 'ai', label: 'AI', icon: <SparklesIcon className="h-5 w-5" aria-hidden="true" /> },
  ];

  return (
    <Modal isOpen onClose={onClose} title="Settings" size="lg">
      <div className="flex flex-col gap-6 sm:flex-row">
        <nav
          aria-label="Settings sections"
          className="flex shrink-0 gap-1 overflow-x-auto sm:w-44 sm:flex-col sm:overflow-visible"
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChangeTab(tab.id)}
              aria-current={activeTab === tab.id ? 'true' : undefined}
              className={`flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
                activeTab === tab.id
                  ? 'bg-hover font-semibold text-ink'
                  : 'text-ink-muted hover:bg-hover hover:text-ink'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1">
          {activeTab === 'profile' && (
            <section className="space-y-6">
              <h3 className="text-lg font-semibold text-ink">Your profile</h3>

              <div className="flex items-center gap-5 border-b border-line pb-6">
                <Avatar user={{ ...currentUser, avatar }} size={72} />
                <div>
                  <label className="inline-block cursor-pointer rounded-md bg-accent px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover">
                    Upload photo
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(event) => handlePickAvatar(event.target.files?.[0])}
                    />
                  </label>
                  <p className="mt-2 text-xs text-ink-subtle">JPG, PNG or GIF, stored in this browser.</p>
                </div>
              </div>

              <Field label="Full name" htmlFor="profile-name">
                <input
                  id="profile-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className={inputClass}
                />
              </Field>

              <Field
                label="Display name"
                htmlFor="profile-handle"
                hint="Used for @mentions. Lowercase, no spaces."
              >
                <input
                  id="profile-handle"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  className={inputClass}
                />
              </Field>

              <Field label="Title" htmlFor="profile-title">
                <input
                  id="profile-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="What do you do here?"
                  className={inputClass}
                />
              </Field>

              <div className="flex items-center justify-end gap-3 border-t border-line pt-4">
                {saved && !dirty && (
                  <span role="status" className="text-sm text-ink-muted">
                    Saved
                  </span>
                )}
                <button
                  type="button"
                  onClick={saveProfile}
                  disabled={!dirty}
                  className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Save changes
                </button>
              </div>
            </section>
          )}

          {activeTab === 'preferences' && (
            <section className="space-y-8">
              <div>
                <h3 className="flex items-center gap-2 text-lg font-semibold text-ink">
                  <PaletteIcon className="h-5 w-5 text-ink-muted" aria-hidden="true" />
                  Appearance
                </h3>
                <p className="mt-1 text-sm text-ink-muted">
                  Choose a theme, or follow your operating system.
                </p>
                <div
                  role="radiogroup"
                  aria-label="Theme"
                  className="mt-3 flex flex-wrap gap-2"
                >
                  {(['light', 'dark', 'system'] as ThemePreference[]).map((option) => (
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={theme === option}
                      onClick={() => onChangeTheme(option)}
                      className={`rounded-md border px-4 py-2 text-sm capitalize transition-colors ${
                        theme === option
                          ? 'border-accent bg-accent/10 font-semibold text-accent'
                          : 'border-line text-ink hover:bg-hover'
                      }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>

              <div className="border-t border-line pt-6">
                <h3 className="flex items-center gap-2 text-lg font-semibold text-ink">
                  <BellIcon className="h-5 w-5 text-ink-muted" aria-hidden="true" />
                  Notifications
                </h3>
                <div className="mt-2 divide-y divide-line">
                  <Toggle
                    label="All new messages"
                    description="Highlight every channel that receives a message."
                    checked={state.notificationPrefs.allMessages}
                    onChange={(next) => setPrefs({ allMessages: next })}
                  />
                  <Toggle
                    label="Mentions and direct messages"
                    description="Badge conversations where you are mentioned."
                    checked={state.notificationPrefs.mentionsAndDms}
                    onChange={(next) => setPrefs({ mentionsAndDms: next })}
                  />
                  <Toggle
                    label="Play a sound"
                    description="Chime when a new message arrives while Chimeway is open."
                    checked={state.notificationPrefs.soundEnabled}
                    onChange={(next) => setPrefs({ soundEnabled: next })}
                  />
                </div>
              </div>

              <div className="border-t border-line pt-6">
                <h3 className="text-lg font-semibold text-ink">Account</h3>
                <p className="mt-1 text-sm text-ink-muted">
                  Your messages are stored on the server and sync across every device you sign in
                  on.
                </p>
                <button
                  type="button"
                  onClick={() => setConfirmSignOut(true)}
                  className="mt-3 rounded-md border border-line px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-hover"
                >
                  Sign out
                </button>
              </div>
            </section>
          )}

          {activeTab === 'ai' && (
            <section className="space-y-5">
              <div>
                <h3 className="text-lg font-semibold text-ink">AI features</h3>
                <p className="mt-1 text-sm text-ink-muted">
                  Thread summaries and channel recaps are generated by Google Gemini.
                </p>
              </div>

              <div className="rounded-lg border border-line bg-sunken p-4 text-sm text-ink-muted">
                <p>
                  The API key is held by the server and never reaches your browser. There is
                  nothing to configure here - if summaries are unavailable, the key has not been
                  set on the deployment.
                </p>
                <p className="mt-2">
                  Requests are limited to 30 per hour per person so a single account cannot run up
                  the bill.
                </p>
              </div>

              <div className="rounded-lg border border-line p-4">
                <p className="text-sm font-medium text-ink">Your usage this hour</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">
                  {aiUsage === null ? '—' : `${aiUsage} / 30`}
                </p>
                <p className="mt-1 text-xs text-ink-subtle">
                  Resets on a rolling one-hour window.
                </p>
              </div>
            </section>
          )}
        </div>
      </div>

      <ConfirmationModal
        isOpen={confirmSignOut}
        onClose={() => setConfirmSignOut(false)}
        onConfirm={() => {
          setConfirmSignOut(false);
          onClose();
          void signOut();
        }}
        title="Sign out"
        confirmText="Sign out"
        variant="danger"
      >
        <p>You will need to sign in again to read or send messages.</p>
      </ConfirmationModal>
    </Modal>
  );
};

/* Mounted only while open, so the profile draft always starts from the
   current values rather than being re-synced by an effect. */
const SettingsModal: React.FC<Props> = ({ isOpen, ...rest }) =>
  isOpen ? <SettingsModalBody {...rest} /> : null;

export default SettingsModal;
