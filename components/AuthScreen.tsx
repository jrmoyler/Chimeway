import React, { useState } from 'react';
import { ApiError, isLocalMode, signIn, signUp } from '../data/api';
import { DEMO_EMAIL, DEMO_PASSWORD } from '../data/localApi';

type Mode = 'signin' | 'signup';

/**
 * Sign-in and sign-up.
 *
 * Errors are surfaced verbatim from Supabase, which deliberately returns the
 * same message for an unknown address and a wrong password - distinguishing
 * them would let anyone enumerate who has an account.
 */
const AuthScreen: React.FC = () => {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;

    setError(null);
    setNotice(null);
    setBusy(true);

    try {
      if (mode === 'signup') {
        const { needsConfirmation } = await signUp(email.trim(), password, fullName.trim());
        if (needsConfirmation) {
          setNotice('Check your email for a confirmation link, then sign in.');
          setMode('signin');
        }
      } else {
        await signIn(email.trim(), password);
      }
      // On success the session listener swaps this screen out.
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const tryDemo = async () => {
    if (busy) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await signIn(DEMO_EMAIL, DEMO_PASSWORD);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not open the demo.');
    } finally {
      setBusy(false);
    }
  };

  const inputClass =
    'block w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none';

  return (
    <div className="flex min-h-dvh items-center justify-center bg-base p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <span
            aria-hidden="true"
            className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-xl font-bold text-white"
          >
            C
          </span>
          <h1 className="mt-4 text-xl font-semibold text-ink">
            {mode === 'signin' ? 'Sign in to Chimeway' : 'Create your account'}
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            {mode === 'signin'
              ? 'Your workspaces are waiting.'
              : 'You can create or join a workspace next.'}
          </p>
        </div>

        {isLocalMode && (
          <div
            role="note"
            className="mb-4 rounded-xl border border-line bg-raised p-4 text-sm text-ink-muted"
          >
            <p>
              <span className="font-medium text-ink">Local mode.</span> No server is connected, so
              accounts and messages are saved in this browser only.
            </p>
            <button
              type="button"
              onClick={() => void tryDemo()}
              disabled={busy}
              className="mt-3 w-full rounded-md border border-line px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-sunken disabled:cursor-not-allowed disabled:opacity-60"
            >
              Try the demo workspace
            </button>
          </div>
        )}

        <form
          onSubmit={submit}
          className="space-y-3 rounded-xl border border-line bg-raised p-5"
          noValidate
        >
          {mode === 'signup' && (
            <div>
              <label htmlFor="auth-name" className="mb-1 block text-sm font-medium text-ink">
                Your name
              </label>
              <input
                id="auth-name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                autoComplete="name"
                required
                className={inputClass}
              />
            </div>
          )}

          <div>
            <label htmlFor="auth-email" className="mb-1 block text-sm font-medium text-ink">
              Email
            </label>
            <input
              id="auth-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="auth-password" className="mb-1 block text-sm font-medium text-ink">
              Password
            </label>
            <input
              id="auth-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              required
              minLength={8}
              className={inputClass}
            />
            {mode === 'signup' && (
              <p className="mt-1 text-xs text-ink-subtle">At least 8 characters.</p>
            )}
          </div>

          {error && (
            <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="rounded-md bg-accent/10 px-3 py-2 text-sm text-accent">
              {notice}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-ink-muted">
          {mode === 'signin' ? "Don't have an account?" : 'Already have an account?'}{' '}
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'signin' ? 'signup' : 'signin');
              setError(null);
              setNotice(null);
            }}
            className="font-medium text-accent hover:underline"
          >
            {mode === 'signin' ? 'Create one' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  );
};

export default AuthScreen;
