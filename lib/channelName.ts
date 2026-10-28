/**
 * Channel name normalisation.
 *
 * Mirrors the identical normalisation in `create_channel()`. The server is
 * authoritative - it runs this regardless of which client is talking to it -
 * but the form needs the same rules locally to preview the final name and to
 * catch an empty result before a round trip.
 *
 * Keep the two in step: supabase/migrations/..._rpcs.sql.
 */
export function normaliseChannelName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-\s]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}
