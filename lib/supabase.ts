import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../database.types';

/**
 * Supabase browser client.
 *
 * The anon key is designed to be public - it identifies the project and
 * nothing more. Every authorization decision is made by Row Level Security in
 * the database, so possessing this key grants no access by itself. The service
 * role key must never appear here, or in any file the bundler can reach.
 */

const url = import.meta.env['VITE_SUPABASE_URL'];
const anonKey = import.meta.env['VITE_SUPABASE_ANON_KEY'];

export const isSupabaseConfigured = Boolean(url && anonKey);

let client: SupabaseClient<Database> | null = null;

export function getSupabase(): SupabaseClient<Database> {
  if (!isSupabaseConfigured) {
    throw new Error(
      'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
    );
  }

  client ??= createClient<Database>(url as string, anonKey as string, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'chimeway:auth',
    },
    realtime: {
      // Caps how fast the server will push to one client, so a very busy
      // channel cannot flood the tab.
      params: { eventsPerSecond: 20 },
    },
    global: {
      headers: { 'x-application-name': 'chimeway' },
    },
  });

  return client;
}

/** Base URL for edge functions, derived from the project URL. */
export function functionsUrl(name: string): string {
  return `${String(url).replace(/\/$/, '')}/functions/v1/${name}`;
}
