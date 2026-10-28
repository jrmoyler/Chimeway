# Chimeway

A team messaging app — channels, direct messages, threads, reactions, file
attachments, mentions, search, and AI summaries — built with React 19,
TypeScript, Vite and Tailwind CSS v4, on Supabase (PostgreSQL, Auth, Realtime,
Storage, Edge Functions).

Real accounts, real multi-user messaging, live updates, and server-held API
keys.

---

## Setup

Requires Node.js 20.19+ and a Supabase project.

```bash
npm install
cp .env.example .env     # then fill in your project URL and anon key
npm run dev
```

The app opens at <http://localhost:3000>. If `.env` is missing or incomplete,
Chimeway shows a setup screen explaining exactly which variables it needs
rather than failing silently.

### 1. Create a Supabase project

At [supabase.com](https://supabase.com). From **Project Settings → API**, copy
the **Project URL** and the **anon / public** key into `.env`:

```bash
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

The anon key is public by design. It identifies the project and grants nothing
on its own — every read and write is checked by row level security in the
database. **Never** put the `service_role` key in `.env`: it bypasses RLS
entirely, and any `VITE_`-prefixed value is readable by every visitor.

### 2. Apply the schema

```bash
npm install -g supabase     # or: brew install supabase/tap/supabase
supabase link --project-ref your-project-ref
npm run db:push
```

That applies everything in `supabase/migrations/` in order: tables, indexes,
row level security policies, triggers, RPCs, the realtime publication, and the
storage bucket.

### 3. Enable AI summaries (optional)

The Gemini key lives on the server and never reaches the browser.

```bash
supabase secrets set GEMINI_API_KEY=your-key
supabase secrets set ALLOWED_ORIGINS=https://your-app-domain
npm run functions:deploy
```

Without this, everything except thread summaries and channel recaps works
normally, and those report that AI is not configured.

### Local development against a local stack

With Docker available you can run the whole backend locally:

```bash
npm run db:start      # Postgres, Auth, Realtime, Storage, Studio
npm run db:reset      # apply migrations + supabase/seed.sql
npm run functions:serve
```

The seed creates two confirmed accounts so you can sign in immediately and see
two people in a workspace: `alice@chimeway.test` and `bob@chimeway.test`, both
with password `password123`. They exist only in your local container.

---

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Typecheck, then build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm run typecheck` | `tsc --noEmit` under `strict` |
| `npm run lint` | ESLint, including `react-hooks` rules |
| `npm test` | Whole suite — app and database |
| `npm run test:db` | Schema, RLS and storage policy tests only |
| `npm run verify` | Typecheck + lint + tests |
| `npm run db:push` | Apply migrations to the linked project |
| `npm run db:reset` | Rebuild the local database from migrations + seed |
| `npm run db:types` | Regenerate types from the live schema |
| `npm run functions:deploy` | Deploy the AI edge function |

---

## Architecture

```
supabase/
  migrations/      Schema, RLS, triggers, RPCs, realtime, storage
  functions/ai/    Gemini proxy (Deno) — holds the API key
  tests/           Schema + RLS + storage tests, run against real Postgres
  seed.sql         Local-only sample workspace

data/              API layer: every call the client makes
  api.ts           Queries, mutations, uploads, AI
  mappers.ts       Database rows -> domain objects

store/
  SessionProvider  Auth state
  StoreProvider    Workspace cache, realtime subscriptions, actions
  cache.ts         Pure realtime patch functions
  selectors.ts     Pure derivations over the cache

lib/               supabase client, time, ids, theme, channel naming
components/        UI, shared primitives under components/ui/
```

### Where authorization lives

In the database, as row level security policies — not in the client.

The browser holds a public key, so the client is not trusted and cannot be.
Anything the policies permit is permitted to anyone with `curl`. Every table
denies by default and is opened only where a policy justifies it:

- You see only workspaces you belong to.
- Public channels are discoverable to workspace members so they can be joined;
  **their messages stay private until you join**.
- Private channels and DMs are invisible to non-members entirely.
- You can only write as yourself, edit and delete your own messages, and move
  your own read marker.
- Attachments are in a private bucket; access is keyed to channel membership
  by the object path, and files are served through short-lived signed URLs.

Membership checks go through `SECURITY DEFINER` helper functions in the `app`
schema. That is deliberate: a policy on `channels` that queried
`channel_members` would trigger that table's own policy, which queries
`channels`, and Postgres would error with infinite recursion. Those functions
pin `search_path`, without which a definer-rights function is a privilege
escalation route.

### Realtime

The client subscribes to `messages`, `message_reactions`, `attachments`,
`channel_members` and `profiles` with no channel filter, because RLS already
limits the stream to rows the subscriber may read. Filtering client-side would
duplicate a rule the database enforces, and get it wrong when someone is added
to a channel mid-session.

Those tables use `REPLICA IDENTITY FULL`, without which an `UPDATE` payload
carries only the primary key — an edited message would arrive with no body.

### AI

`supabase/functions/ai` is a narrow proxy, not a general Gemini endpoint. It
takes a channel or thread id and a mode, never prompt text, so a signed-in user
cannot spend the key on arbitrary prompts. It reads the conversation using the
**caller's** JWT, so RLS decides what may be summarised — the same policies as
everywhere else, rather than a second hand-written copy of the rules. Requests
are capped at 30 per hour per person, enforced in the database so the limit
survives cold starts and holds across function instances.

---

## Testing

```bash
npm test
```

Database tests run the real migrations against real PostgreSQL via
[PGlite](https://pglite.dev) (Postgres compiled to WebAssembly), with a
faithful stand-in for Supabase's `auth.users`, `auth.uid()`, the `anon` /
`authenticated` roles, and the storage schema. No Docker required, and they run
in CI.

This matters because RLS *is* the backend's security boundary. Reading a policy
and reasoning about it is not verification — these tests execute every policy
as several different users and assert what each one can actually reach.

That caught a real hole during development: an insert policy on
`workspace_members` had a "allow if the workspace has no members yet" branch,
written as `not exists (select ... from workspace_members ...)`. That subquery
is itself filtered by RLS, so a stranger — who can see none of a workspace's
members — made it evaluate true and could add themselves to any workspace. The
branch is gone; bootstrapping happens in `create_workspace()` under definer
rights.

---

### Integrity

Row level security decides *who* may write; it says nothing about *what*. A
second pass added the content constraints:

- `created_at` is assigned by a trigger, so a client cannot backdate a message
  to sit above existing history.
- A message must carry text or at least one attachment, enforced by a deferred
  constraint trigger that evaluates at commit — which is why attachment
  messages go through `send_message()`, writing the message and its
  attachments in one transaction.
- Mentions match on a word boundary, so `@alice2` no longer alerts `@alice`.
- Search escapes LIKE metacharacters, so a query of `%%` no longer matches
  every message.
- `created_by` is `ON DELETE SET NULL`, so deleting a user does not fail
  against workspaces they created — an erasure request is satisfiable.
- `create_dm()` takes an advisory lock on the sorted member set, so two
  simultaneous calls cannot create parallel conversations for the same people.

`npm run audit:secrets` fails the build if a service_role JWT, Google API key
or assigned Gemini key reaches `dist/`. It matches credential shapes rather
than keywords, and skips sourcemaps — which legitimately contain library
documentation mentioning `service_role`.

Sourcemaps are built with `sourcemap: 'hidden'`: the `.map` files are emitted
for upload to an error tracker but carry no `sourceMappingURL`, so browsers do
not fetch them and your original source is not served to visitors.

---

## Known limits

- **Email confirmation is off by default** (`supabase/config.toml`). Turn it on
  for production so addresses are verified before an account works.
- **No invite flow yet.** Adding someone to a workspace is an admin-only insert
  into `workspace_members`; there is no UI for it.
- **Presence is manual.** Status is whatever a person last set, not inferred
  from activity.
- **Message history loads the most recent 80 per channel**, with older ones on
  demand. There is no full-text jump-to-message from a search result yet.
