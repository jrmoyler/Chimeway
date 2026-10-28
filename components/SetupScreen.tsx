import React from 'react';
import { missingConfigKeys } from '../lib/supabase';

/**
 * Shown when the Supabase environment variables are absent.
 *
 * The previous build failed in exactly this situation by rendering nothing at
 * all, with the cause visible only in the console. A misconfigured deployment
 * should say so.
 */
const SetupScreen: React.FC = () => {
  const missing = missingConfigKeys();

  return (
    <div className="flex min-h-dvh items-center justify-center bg-base p-6">
      <div className="w-full max-w-lg rounded-xl border border-line bg-raised p-6">
        <h1 className="text-lg font-semibold text-ink">Chimeway is not connected yet</h1>
        <p className="mt-2 text-sm text-ink-muted">
          The app needs a Supabase project before it can sign anyone in. Create a{' '}
          <code className="rounded bg-sunken px-1 py-0.5 text-xs">.env</code> file in the project
          root with:
        </p>

        <pre className="mt-4 overflow-x-auto rounded-md bg-sunken p-3 text-xs text-ink">
{`VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your anon key>`}
        </pre>

        {missing.length > 0 && (
          <p className="mt-3 text-sm text-danger">
            Missing: <span className="font-mono">{missing.join(', ')}</span>
          </p>
        )}

        <p className="mt-4 text-sm text-ink-muted">
          Both values are in your Supabase dashboard under{' '}
          <span className="font-medium text-ink">Project Settings → API</span>. The anon key is
          safe to expose: access is controlled by row level security, not by the key. Never put
          the service role key here.
        </p>

        <p className="mt-3 text-xs text-ink-subtle">
          Restart the dev server after editing <code>.env</code> — Vite only reads it at startup.
        </p>
      </div>
    </div>
  );
};

export default SetupScreen;
