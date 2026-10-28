/**
 * Gemini proxy.
 *
 * This exists so the API key lives on the server. In the previous build the
 * key was expected in client code, where Vite either refused to expose it (so
 * the feature silently never worked) or would have shipped it to every visitor.
 *
 * Two deliberate properties:
 *
 *  1. The function fetches the conversation itself, using the CALLER's JWT, so
 *     Row Level Security decides what may be summarised. Authorization is the
 *     same policy set that governs every other read - there is no second,
 *     hand-written copy of the rules to drift out of sync.
 *
 *  2. It does not accept a prompt. Callers pass a channel or thread id and a
 *     mode; the prompt is assembled here. Accepting prompt text would turn a
 *     key-holding endpoint into a general-purpose Gemini account that any
 *     signed-in user could spend.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const MODEL = 'gemini-2.5-flash';
const GEMINI_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const UPSTREAM_TIMEOUT_MS = 30_000;
const MAX_MESSAGES = 60;

type Mode = 'channel_recap' | 'thread_summary';

interface RequestBody {
  mode?: Mode;
  channelId?: string;
  rootMessageId?: string;
}

interface MessageRow {
  id: string;
  body: string;
  created_at: string;
  user_id: string;
  parent_id: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const corsHeaders = (origin: string): Record<string, string> => ({
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
});

function json(body: unknown, status: number, origin: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  });
}

/** Only echo an Origin we actually allow, rather than reflecting any caller. */
function resolveOrigin(req: Request): string {
  const allowed = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const origin = req.headers.get('Origin') ?? '';
  if (allowed.length === 0) return origin || '*';
  return allowed.includes(origin) ? origin : allowed[0]!;
}

function renderConversation(
  messages: MessageRow[],
  names: Map<string, string>,
): string {
  return messages
    .map((m) => `${names.get(m.user_id) ?? 'Unknown user'} at ${m.created_at}:\n${m.body}`)
    .join('\n\n---\n\n');
}

function buildPrompt(mode: Mode, conversation: string): string {
  if (mode === 'thread_summary') {
    return `You are summarising one thread from a team chat application.

Summarise the conversation below concisely. Lead with the question or topic that started it, then cover key decisions and any action items with their owners. Use markdown headings and bullet points. If there are no decisions or action items, say so rather than inventing them.

Thread:
${conversation}`;
  }

  return `You are catching someone up on a team chat channel.

Give a brief recap of the recent messages below. Highlight key discussions, unresolved questions, and announcements. Keep it short and scannable with markdown bullet points. Do not invent detail that is not present.

Recent messages:
${conversation}`;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = resolveOrigin(req);

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, origin);
  }

  const apiKey = Deno.env.get('GEMINI_API_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');

  if (!apiKey || !supabaseUrl || !anonKey) {
    // Deliberately vague to the caller; the detail goes to the server log.
    console.error('ai: missing configuration', {
      hasGeminiKey: Boolean(apiKey),
      hasUrl: Boolean(supabaseUrl),
      hasAnonKey: Boolean(anonKey),
    });
    return json({ error: 'AI is not configured on this deployment.' }, 503, origin);
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return json({ error: 'Sign in to use AI features.' }, 401, origin);
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Malformed request body.' }, 400, origin);
  }

  const mode = body.mode;
  if (mode !== 'channel_recap' && mode !== 'thread_summary') {
    return json({ error: 'Unsupported mode.' }, 400, origin);
  }
  if (!body.channelId || !UUID_RE.test(body.channelId)) {
    return json({ error: 'A valid channelId is required.' }, 400, origin);
  }
  if (mode === 'thread_summary' && (!body.rootMessageId || !UUID_RE.test(body.rootMessageId))) {
    return json({ error: 'A valid rootMessageId is required.' }, 400, origin);
  }

  // The caller's own credentials: every read below is filtered by RLS, so this
  // function cannot reach anything the user could not read directly.
  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth?.user) {
    return json({ error: 'Sign in to use AI features.' }, 401, origin);
  }

  // Quota is enforced before the upstream call, so a rejected request costs
  // nothing.
  const { error: quotaError } = await supabase.rpc('record_ai_request', { p_kind: mode });
  if (quotaError) {
    const overQuota = /limit reached/i.test(quotaError.message);
    return json(
      { error: overQuota ? quotaError.message : 'Could not start the AI request.' },
      overQuota ? 429 : 400,
      origin,
    );
  }

  let query = supabase
    .from('messages')
    .select('id, body, created_at, user_id, parent_id')
    .eq('channel_id', body.channelId);

  query =
    mode === 'thread_summary'
      ? query.or(`id.eq.${body.rootMessageId},parent_id.eq.${body.rootMessageId}`)
      : query.is('parent_id', null);

  const { data: messages, error: messagesError } = await query
    .order('created_at', { ascending: false })
    .limit(MAX_MESSAGES);

  if (messagesError) {
    console.error('ai: message fetch failed', messagesError.message);
    return json({ error: 'Could not read the conversation.' }, 500, origin);
  }

  // RLS returning nothing is indistinguishable from an empty channel, and
  // both deserve the same answer: there is nothing to summarise.
  if (!messages || messages.length === 0) {
    return json({ error: 'There is nothing to summarise here yet.' }, 404, origin);
  }

  const ordered = [...(messages as MessageRow[])].reverse();

  const authorIds = [...new Set(ordered.map((m) => m.user_id))];
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name, display_name')
    .in('id', authorIds);

  const names = new Map<string, string>(
    (profiles ?? []).map((p: { id: string; full_name: string; display_name: string }) => [
      p.id,
      p.full_name || p.display_name,
    ]),
  );

  const prompt = buildPrompt(mode, renderConversation(ordered, names));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstream = await fetch(GEMINI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Header, not a query string: query strings end up in access logs.
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
      }),
      signal: controller.signal,
    });

    if (!upstream.ok) {
      // Never forward the upstream body: it can echo request details.
      console.error('ai: upstream error', upstream.status);
      return json(
        { error: 'The AI service is unavailable right now. Please try again.' },
        502,
        origin,
      );
    }

    const payload = await upstream.json();
    const text: unknown = payload?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (typeof text !== 'string' || !text.trim()) {
      return json({ error: 'The model returned an empty response.' }, 502, origin);
    }

    return json({ text, messageCount: ordered.length }, 200, origin);
  } catch (error) {
    if (controller.signal.aborted) {
      return json({ error: 'The AI request timed out. Please try again.' }, 504, origin);
    }
    console.error('ai: unexpected failure', error instanceof Error ? error.message : error);
    return json({ error: 'The AI request failed.' }, 500, origin);
  } finally {
    clearTimeout(timeout);
  }
});
