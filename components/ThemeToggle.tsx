import React from 'react';
import type { ThemePreference } from '../types';
import { SunIcon } from './icons/SunIcon';
import { MoonIcon } from './icons/MoonIcon';

const NEXT: Record<ThemePreference, ThemePreference> = {
  light: 'dark',
  dark: 'system',
  system: 'light',
};

const LABEL: Record<ThemePreference, string> = {
  light: 'Light theme',
  dark: 'Dark theme',
  system: 'Matching your system',
};

interface Props {
  theme: ThemePreference;
  resolved: 'light' | 'dark';
  onChange: (next: ThemePreference) => void;
}

/**
 * Quick theme cycle: light -> dark -> system.
 *
 * The original put this in a floating overlay pinned over the top-right of the
 * app, where it sat on top of the channel header. Here it lives in the sidebar
 * footer next to the other utility controls.
 */
const ThemeToggle: React.FC<Props> = ({ theme, resolved, onChange }) => (
  <button
    type="button"
    onClick={() => onChange(NEXT[theme])}
    aria-label={`${LABEL[theme]}. Switch to ${LABEL[NEXT[theme]].toLowerCase()}.`}
    title={LABEL[theme]}
    className="relative shrink-0 rounded-md p-1.5 text-ink-muted transition-colors hover:bg-hover hover:text-ink"
  >
    {resolved === 'dark' ? (
      <MoonIcon className="h-5 w-5" aria-hidden="true" />
    ) : (
      <SunIcon className="h-5 w-5" aria-hidden="true" />
    )}
    {theme === 'system' && (
      <span
        aria-hidden="true"
        title="Following your system setting"
        className="absolute bottom-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-accent"
      />
    )}
  </button>
);

export default ThemeToggle;
