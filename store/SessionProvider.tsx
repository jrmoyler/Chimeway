import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { getSupabase, isSupabaseConfigured } from '../lib/supabase';
import { getLocalSessionUserId, onLocalAuthChange } from '../data/localApi';

/**
 * Authentication state.
 *
 * Kept separate from workspace data so the app can render a sign-in screen
 * without first attempting (and failing) to load a workspace. Without a
 * Supabase project the session comes from local mode instead (see data/api.ts).
 */

interface SessionContextValue {
  userId: string | null;
  /** False until the initial session restore has settled. */
  ready: boolean;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export const SessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [userId, setUserId] = useState<string | null>(() =>
    isSupabaseConfigured ? null : getLocalSessionUserId(),
  );
  const [ready, setReady] = useState(!isSupabaseConfigured);

  useEffect(() => {
    if (!isSupabaseConfigured) return onLocalAuthChange(setUserId);

    const supabase = getSupabase();
    let active = true;

    // Restore any persisted session before deciding what to render; otherwise
    // a reload flashes the sign-in screen for an already-signed-in user.
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setUserId(data.session?.user.id ?? null);
      setReady(true);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return;
      setUserId(next?.user.id ?? null);
      setReady(true);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<SessionContextValue>(() => ({ userId, ready }), [userId, ready]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
};

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within a SessionProvider');
  return ctx;
}
