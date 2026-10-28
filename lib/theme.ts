import type { ThemePreference } from '../types';

/**
 * Theme persistence.
 *
 * The original read the OS preference once into component state and never
 * stored the user's choice, so toggling the theme was forgotten on refresh,
 * and there was no way to follow the system setting after an explicit choice.
 *
 * Resolution ("system" -> light/dark) is done in the component via
 * `useMediaQuery`, so it stays reactive without writing state from an effect.
 * The pre-paint application lives inline in index.html; keep the storage key
 * and the resolution rule here in sync with it.
 */

export const THEME_STORAGE_KEY = 'chimeway:theme';

export function getStoredTheme(): ThemePreference {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
  } catch {
    // Storage can throw in private mode.
    return 'system';
  }
}

export function persistTheme(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // The theme still applies for this session; it just will not be remembered.
  }
}

/** Applies the resolved appearance to the document root. */
export function applyResolvedTheme(resolved: 'light' | 'dark'): void {
  document.documentElement.classList.toggle('dark', resolved === 'dark');
}
