import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

/**
 * Runs the real migrations against real PostgreSQL (PGlite, WASM) with a
 * faithful stand-in for the parts Supabase provides.
 *
 * This matters because RLS policies are the entire security boundary of this
 * backend - the browser holds a public key, so anything the policies permit is
 * permitted to anyone. Reading policies and reasoning about them is not
 * verification; executing them as different users is.
 *
 * What is emulated, and why it is faithful:
 *   - `auth.users`      Supabase's user table. The signup trigger hangs off it.
 *   - `auth.uid()`      Supabase reads the `sub` claim out of the request JWT.
 *                       Here it reads the same GUC PostgREST sets.
 *   - `anon` /          The PostgREST roles. Policies are written `to
 *     `authenticated`   authenticated`, and switching role is what makes
 *                       "signed out" vs "signed in" a real distinction.
 */

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

const SUPABASE_PRELUDE = `
  create schema if not exists auth;

  -- PostgREST connects as one of these; RLS policies target them by name.
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then
      create role anon nologin noinherit;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
      create role authenticated nologin noinherit;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then
      create role service_role nologin noinherit bypassrls;
    end if;
  end $$;

  grant usage on schema public to anon, authenticated, service_role;

  create table auth.users (
    id                  uuid primary key default gen_random_uuid(),
    email               text unique,
    raw_user_meta_data  jsonb not null default '{}'::jsonb,
    created_at          timestamptz not null default now()
  );

  -- Mirrors Supabase: the signed-in user id comes from the request JWT claims.
  create or replace function auth.uid() returns uuid
  language sql stable as $$
    select nullif(
      coalesce(
        current_setting('request.jwt.claim.sub', true),
        (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
      ),
      ''
    )::uuid
  $$;

  create or replace function auth.role() returns text
  language sql stable as $$
    select coalesce(current_setting('request.jwt.claim.role', true), 'anon')
  $$;

  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant execute on function auth.role() to anon, authenticated, service_role;

  -- Supabase Storage. Stubbed to the shape the storage policies depend on, so
  -- those policies are actually executed here rather than skipped.
  create schema if not exists storage;

  create table storage.buckets (
    id                 text primary key,
    name               text not null,
    public             boolean not null default false,
    file_size_limit    bigint,
    allowed_mime_types text[],
    created_at         timestamptz not null default now()
  );

  create table storage.objects (
    id         uuid primary key default gen_random_uuid(),
    bucket_id  text not null references storage.buckets (id) on delete cascade,
    name       text not null,
    owner_id   text,
    created_at timestamptz not null default now(),
    unique (bucket_id, name)
  );

  alter table storage.objects enable row level security;

  -- Matches Supabase: splits an object key on '/' into its path segments.
  create or replace function storage.foldername(name text)
  returns text[] language sql immutable as $$
    select string_to_array(name, '/')
  $$;

  grant usage on schema storage to anon, authenticated, service_role;
  grant select, insert, delete on storage.objects to authenticated;
  grant select on storage.buckets to authenticated;
  grant execute on function storage.foldername(text) to anon, authenticated, service_role;
`;

export interface TestDb {
  /** Run SQL with full privileges (migrations, fixtures, assertions). */
  admin<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Run SQL as a signed-in user, with RLS enforced exactly as in production. */
  as<T = Record<string, unknown>>(userId: string, sql: string, params?: unknown[]): Promise<T[]>;
  /** Run SQL as an anonymous visitor (signed out). */
  anon<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Create an auth user, firing the signup trigger. Returns the user id. */
  createUser(email: string, meta?: Record<string, unknown>): Promise<string>;
  close(): Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const db = await PGlite.create();

  await db.exec(SUPABASE_PRELUDE);

  // Apply migrations in filename order, exactly as the Supabase CLI does.
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    try {
      await db.exec(sql);
    } catch (error) {
      throw new Error(
        `Migration ${file} failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  const reset = async () => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', true);`);
  };

  const admin = async <T>(sql: string, params?: unknown[]): Promise<T[]> => {
    await reset();
    const result = await db.query<T>(sql, params as never[]);
    return result.rows;
  };

  const as = async <T>(userId: string, sql: string, params?: unknown[]): Promise<T[]> => {
    // Order matters: set the claim before switching role, because a
    // non-superuser may not be permitted to set it afterwards.
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId]);
    await db.query(`select set_config('request.jwt.claim.role', 'authenticated', false)`);
    await db.exec('set role authenticated');
    try {
      const result = await db.query<T>(sql, params as never[]);
      return result.rows;
    } finally {
      await db.exec('reset role');
    }
  };

  const anon = async <T>(sql: string, params?: unknown[]): Promise<T[]> => {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
    await db.query(`select set_config('request.jwt.claim.role', 'anon', false)`);
    await db.exec('set role anon');
    try {
      const result = await db.query<T>(sql, params as never[]);
      return result.rows;
    } finally {
      await db.exec('reset role');
    }
  };

  const createUser = async (email: string, meta: Record<string, unknown> = {}) => {
    const rows = await admin<{ id: string }>(
      `insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id`,
      [email, JSON.stringify(meta)],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error(`failed to create user ${email}`);
    return id;
  };

  return {
    admin,
    as,
    anon,
    createUser,
    close: async () => {
      await db.close();
    },
  };
}

/** Asserts that a statement is rejected, and returns the error for inspection. */
export async function expectRejection(run: () => Promise<unknown>): Promise<Error> {
  try {
    await run();
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  throw new Error('Expected the statement to be rejected, but it succeeded.');
}
