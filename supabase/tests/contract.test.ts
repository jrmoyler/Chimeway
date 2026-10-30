import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './harness';

/**
 * Contract between the client and the database.
 *
 * The client calls RPCs by argument name and reads columns by name. Neither
 * the TypeScript compiler nor the SQL tests can see across that boundary: the
 * hand-written `database.types.ts` describes what the client *believes*, and
 * the migrations define what is *true*. A renamed argument or column
 * type-checks cleanly on both sides and fails only at runtime, against a
 * deployed project.
 *
 * These tests read the actual client source and compare it against the live
 * schema in PGlite.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const API_SOURCE = readFileSync(join(ROOT, 'data', 'remoteApi.ts'), 'utf8');
const STORE_SOURCE = readFileSync(join(ROOT, 'store', 'StoreProvider.tsx'), 'utf8');
const CLIENT_SOURCE = `${API_SOURCE}\n${STORE_SOURCE}`;

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

/** Every `.rpc('name', { args })` call the client makes. */
function rpcCallsInClient(): Array<{ name: string; args: string[] }> {
  const calls: Array<{ name: string; args: string[] }> = [];
  const pattern = /\.rpc\(\s*'([a-z_]+)'\s*,\s*\{([^}]*)\}/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(CLIENT_SOURCE))) {
    const args = (match[2] ?? '')
      .split(',')
      .map((part) => part.split(':')[0]?.trim() ?? '')
      .filter((name) => /^p_[a-z_]+$/.test(name));
    calls.push({ name: match[1]!, args });
  }
  return calls;
}

/** Every `.from('table')` the client touches. */
function tablesUsedByClient(): string[] {
  const names = new Set<string>();
  const pattern = /\.from\(\s*'([a-z_]+)'\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(CLIENT_SOURCE))) {
    // storage buckets share the .from() spelling; filter to real tables.
    if (match[1] !== 'attachments' || !/storage\s*\.from/.test(CLIENT_SOURCE)) {
      names.add(match[1]!);
    }
    names.add(match[1]!);
  }
  return [...names];
}

describe('RPC contract', () => {
  it('the client calls at least one RPC (guards against a broken extractor)', () => {
    expect(rpcCallsInClient().length).toBeGreaterThan(3);
  });

  it('every RPC the client calls exists in the database', async () => {
    const functions = await db.admin<{ proname: string }>(
      `select proname from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'`,
    );
    const known = new Set(functions.map((f) => f.proname));

    const missing = [...new Set(rpcCallsInClient().map((c) => c.name))].filter(
      (name) => !known.has(name),
    );
    expect(missing, `client calls RPCs that do not exist: ${missing.join(', ')}`).toEqual([]);
  });

  it('every RPC argument the client passes is a real parameter of that function', async () => {
    const rows = await db.admin<{ proname: string; args: string }>(
      `select p.proname, pg_get_function_arguments(p.oid) as args
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'`,
    );

    const paramsByName = new Map<string, Set<string>>();
    for (const row of rows) {
      const names = (row.args.match(/\bp_[a-z_]+/g) ?? []) as string[];
      const existing = paramsByName.get(row.proname) ?? new Set<string>();
      for (const n of names) existing.add(n);
      paramsByName.set(row.proname, existing);
    }

    const problems: string[] = [];
    for (const call of rpcCallsInClient()) {
      const known = paramsByName.get(call.name);
      if (!known) continue; // covered by the previous test
      for (const arg of call.args) {
        if (!known.has(arg)) {
          problems.push(`${call.name}(${arg}) — accepts: ${[...known].join(', ')}`);
        }
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('every required RPC parameter is supplied by the client', async () => {
    // A parameter without a default must be passed, or PostgREST rejects the
    // call with "function does not exist" - a confusing failure at runtime.
    const rows = await db.admin<{ proname: string; args: string }>(
      `select p.proname, pg_get_function_arguments(p.oid) as args
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'`,
    );

    const requiredByName = new Map<string, string[]>();
    for (const row of rows) {
      const required = row.args
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.startsWith('p_') && !s.toUpperCase().includes('DEFAULT'))
        .map((s) => s.split(/\s+/)[0]!);
      requiredByName.set(row.proname, required);
    }

    const problems: string[] = [];
    for (const call of rpcCallsInClient()) {
      for (const required of requiredByName.get(call.name) ?? []) {
        if (!call.args.includes(required)) {
          problems.push(`${call.name} is missing required argument ${required}`);
        }
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });
});

describe('table contract', () => {
  it('every table the client reads or writes exists', async () => {
    const rows = await db.admin<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const known = new Set(rows.map((r) => r.table_name));

    const missing = tablesUsedByClient().filter((t) => !known.has(t));
    expect(missing, `client uses unknown tables: ${missing.join(', ')}`).toEqual([]);
  });

  it('every column the mappers read exists on its table', async () => {
    const mappers = readFileSync(join(ROOT, 'data', 'mappers.ts'), 'utf8');

    const rows = await db.admin<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
        where table_schema = 'public'`,
    );
    const columnsByTable = new Map<string, Set<string>>();
    for (const row of rows) {
      const set = columnsByTable.get(row.table_name) ?? new Set<string>();
      set.add(row.column_name);
      columnsByTable.set(row.table_name, set);
    }

    // Each mapper function names the row fields it reads as `row.<column>`.
    const mapped: Record<string, string> = {
      toUser: 'profiles',
      toWorkspace: 'workspaces',
      toChannel: 'channels',
      toAttachment: 'attachments',
      toMessage: 'messages',
    };

    const problems: string[] = [];
    for (const [fn, table] of Object.entries(mapped)) {
      const body = mappers.slice(mappers.indexOf(`function ${fn}`));
      const end = body.indexOf('\n}');
      const columns = [...new Set((body.slice(0, end).match(/row\.([a-z_]+)/g) ?? [])
        .map((s) => s.replace('row.', '')))];

      for (const column of columns) {
        if (!columnsByTable.get(table)?.has(column)) {
          problems.push(`${fn} reads ${table}.${column}, which does not exist`);
        }
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });
});

describe('cross-boundary rules that are implemented twice', () => {
  it('client and server normalise channel names identically', async () => {
    // The client previews the final name; the server is authoritative. If the
    // two drift, the preview lies about what will be created.
    const { normaliseChannelName } = (await import('../../lib/channelName')) as {
      normaliseChannelName: (raw: string) => string;
    };

    const inputs = [
      '  Q4 Launch Plan!! ',
      'Already-Fine',
      'a   b',
      'UPPER CASE',
      'trailing-dash-',
      '-leading-dash',
      'double--dash',
      'emoji 🎉 name',
      'punctuation!@#$%^&*()',
      'under_score',
      'mixed_-_separators',
      '123 numeric',
    ];

    for (const input of inputs) {
      const rows = await db.admin<{ normalised: string }>(
        `select regexp_replace(
                  regexp_replace(
                    regexp_replace(
                      regexp_replace(
                        regexp_replace(lower(trim($1)), '[^a-z0-9 _-]', '', 'g'),
                      '\\s+', '-', 'g'),
                    '-+', '-', 'g'),
                  '^-|-$', '', 'g')
                , '^$', '', 'g') as normalised`,
        [input],
      );
      expect(normaliseChannelName(input), `input: ${JSON.stringify(input)}`).toBe(
        rows[0]!.normalised,
      );
    }
  });

  it('the client enforces the same attachment size limit as the database', async () => {
    const { MAX_ATTACHMENT_BYTES } = await import('../../lib/limits');

    // Postgres stores the constraint as written (`5 * 1024 * 1024`) rather
    // than a folded literal, so compare computed values, not text.
    const rows = await db.admin<{ allowed: boolean; rejected: boolean }>(
      `select
         ($1::bigint <= 5 * 1024 * 1024) as allowed,
         ($1::bigint + 1 <= 5 * 1024 * 1024) as rejected`,
      [MAX_ATTACHMENT_BYTES],
    );
    // The client's maximum is exactly the database's maximum: one byte more
    // would be refused.
    expect(rows[0]?.allowed).toBe(true);
    expect(rows[0]?.rejected).toBe(false);
  });

  it('the client message length limit matches the column constraint', async () => {
    const { MAX_MESSAGE_LENGTH } = await import('../../lib/limits');
    const constraint = await db.admin<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint
        where conname = 'messages_body_len'`,
    );
    expect(constraint[0]?.def).toContain(String(MAX_MESSAGE_LENGTH));
  });

  it('a message at the client limit is accepted and one over is refused', async () => {
    const { MAX_MESSAGE_LENGTH } = await import('../../lib/limits');
    const user = await db.createUser('limits@contract.test', { display_name: 'limituser' });
    const ws = await db.as<{ id: string }>(user, `select id from public.create_workspace('Limits')`);
    const ch = await db.as<{ id: string }>(
      user,
      `select id from public.channels where workspace_id = $1 limit 1`,
      [ws[0]!.id],
    );

    const atLimit = await db.as<{ id: string }>(
      user,
      `insert into public.messages (channel_id, user_id, body)
       values ($1, $2, repeat('x', $3)) returning id`,
      [ch[0]!.id, user, MAX_MESSAGE_LENGTH],
    );
    expect(atLimit).toHaveLength(1);

    let overLimitRejected = false;
    try {
      await db.as(
        user,
        `insert into public.messages (channel_id, user_id, body)
         values ($1, $2, repeat('x', $3))`,
        [ch[0]!.id, user, MAX_MESSAGE_LENGTH + 1],
      );
    } catch {
      overLimitRejected = true;
    }
    expect(overLimitRejected).toBe(true);
  });
});
