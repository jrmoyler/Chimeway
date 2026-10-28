import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, expectRejection, type TestDb } from './harness';

/**
 * Second QA pass: data integrity and edge-case input rather than access
 * control. The first pass asked "who can reach what"; this asks "what can a
 * well-authorised caller put into the database that it should not contain".
 */

let db: TestDb;
let alice: string;
let bob: string;
let workspace: string;
let channel: string;

beforeAll(async () => {
  db = await createTestDb();
  alice = await db.createUser('alice@int.test', { display_name: 'alice' });
  bob = await db.createUser('bob@int.test', { display_name: 'bob' });

  const ws = await db.as<{ id: string }>(alice, `select id from public.create_workspace('Integrity')`);
  workspace = ws[0]!.id;
  await db.admin(`insert into public.workspace_members (workspace_id, user_id) values ($1,$2)`, [
    workspace,
    bob,
  ]);

  const ch = await db.as<{ id: string }>(
    alice,
    `select id from public.channels where workspace_id = $1 limit 1`,
    [workspace],
  );
  channel = ch[0]!.id;
  await db.admin(`insert into public.channel_members (channel_id, user_id) values ($1,$2)`, [
    channel,
    bob,
  ]);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe('message timestamps', () => {
  it('cannot be backdated by the client', async () => {
    // A forged created_at would let someone insert a message that appears
    // above existing history, or hide one at the bottom of a long channel.
    const rows = await db.as<{ created_at: string }>(
      alice,
      `insert into public.messages (channel_id, user_id, body, created_at)
       values ($1, $2, 'backdated', '2000-01-01T00:00:00Z') returning created_at`,
      [channel, alice],
    );
    const stored = new Date(rows[0]!.created_at).getFullYear();
    expect(stored).toBeGreaterThan(2020);
  });
});

describe('empty messages', () => {
  it('are rejected when there is no text and no attachment', async () => {
    const error = await expectRejection(() =>
      db.as(alice, `insert into public.messages (channel_id, user_id, body) values ($1,$2,'')`, [
        channel,
        alice,
      ]),
    );
    expect(error.message).toMatch(/text or at least one attachment/i);
  });

  it('are rejected when the body is only whitespace', async () => {
    const error = await expectRejection(() =>
      db.as(alice, `insert into public.messages (channel_id, user_id, body) values ($1,$2,'   ')`, [
        channel,
        alice,
      ]),
    );
    expect(error.message).toMatch(/text or at least one attachment/i);
  });

  it('cannot be emptied by a later edit', async () => {
    const msg = await db.as<{ id: string }>(
      alice,
      `insert into public.messages (channel_id, user_id, body) values ($1,$2,'real') returning id`,
      [channel, alice],
    );
    const error = await expectRejection(() =>
      db.as(alice, `update public.messages set body = '' where id = $1`, [msg[0]!.id]),
    );
    expect(error.message).toMatch(/text or at least one attachment/i);
  });
});

describe('mention detection', () => {
  it('does not treat @alice2 as a mention of alice', async () => {
    // Substring matching would make every handle a prefix of a longer one
    // generate false mentions.
    const carol = await db.createUser('carol@int.test', { display_name: 'alice2' });
    await db.admin(`insert into public.workspace_members (workspace_id, user_id) values ($1,$2)`, [
      workspace,
      carol,
    ]);
    await db.admin(`insert into public.channel_members (channel_id, user_id) values ($1,$2)`, [
      channel,
      carol,
    ]);

    await db.as(alice, `select public.mark_channel_read($1)`, [channel]);
    await db.as(bob, `insert into public.messages (channel_id, user_id, body) values ($1,$2,$3)`, [
      channel,
      bob,
      'hey @alice2 can you look',
    ]);

    const rows = await db.as<{ channel_id: string; has_mention: boolean }>(
      alice,
      `select channel_id, has_mention from public.unread_counts($1)`,
      [workspace],
    );
    expect(rows.find((r) => r.channel_id === channel)?.has_mention).toBe(false);
  });

  it('still detects a real mention followed by punctuation', async () => {
    await db.as(alice, `select public.mark_channel_read($1)`, [channel]);
    await db.as(bob, `insert into public.messages (channel_id, user_id, body) values ($1,$2,$3)`, [
      channel,
      bob,
      'thanks @alice!',
    ]);

    const rows = await db.as<{ channel_id: string; has_mention: boolean }>(
      alice,
      `select channel_id, has_mention from public.unread_counts($1)`,
      [workspace],
    );
    expect(rows.find((r) => r.channel_id === channel)?.has_mention).toBe(true);
  });
});

describe('search input handling', () => {
  it('treats SQL wildcards in a query as literal text', async () => {
    await db.as(alice, `insert into public.messages (channel_id, user_id, body) values ($1,$2,$3)`, [
      channel,
      alice,
      'literal percent % sign here',
    ]);
    await db.as(alice, `insert into public.messages (channel_id, user_id, body) values ($1,$2,$3)`, [
      channel,
      alice,
      'nothing special',
    ]);

    // A bare '%' must not match every message.
    const rows = await db.as(alice, `select id from public.search_messages($1, '%%')`, [workspace]);
    expect(rows.length).toBeLessThan(5);
  });

  it('handles a query of only punctuation without erroring', async () => {
    const rows = await db.as(alice, `select id from public.search_messages($1, '!!!')`, [workspace]);
    expect(Array.isArray(rows)).toBe(true);
  });
});

describe('account deletion', () => {
  it('does not wedge on workspaces the user created', async () => {
    // created_by with ON DELETE RESTRICT would make a GDPR deletion request
    // impossible to satisfy without hand-editing rows.
    const temp = await db.createUser('temp@int.test', { display_name: 'tempuser' });
    await db.as(temp, `select id from public.create_workspace('Temp Co')`);

    await db.admin(`delete from auth.users where id = $1`, [temp]);

    const remaining = await db.admin<{ n: number }>(
      `select count(*)::int as n from public.profiles where id = $1`,
      [temp],
    );
    expect(remaining[0]?.n).toBe(0);
  });
});

describe('direct message edge cases', () => {
  it('refuses a DM addressed only to yourself', async () => {
    const error = await expectRejection(() =>
      db.as(alice, `select public.create_dm($1, $2::uuid[])`, [workspace, [alice]]),
    );
    expect(error.message).toMatch(/at least one other person/i);
  });

  it('refuses an empty participant list', async () => {
    const error = await expectRejection(() =>
      db.as(alice, `select public.create_dm($1, '{}'::uuid[])`, [workspace]),
    );
    expect(error.message).toMatch(/at least one other person/i);
  });

  it('ignores duplicates in the participant list', async () => {
    const dm = await db.as<{ id: string }>(
      alice,
      `select id from public.create_dm($1, $2::uuid[])`,
      [workspace, [bob, bob, bob]],
    );
    const members = await db.admin<{ n: number }>(
      `select count(*)::int as n from public.channel_members where channel_id = $1`,
      [dm[0]!.id],
    );
    expect(members[0]?.n).toBe(2);
  });
});

describe('migration safety', () => {
  it('declares an index for every foreign key used in a policy predicate', async () => {
    // Policy predicates run per row. An unindexed membership lookup turns
    // every read into a sequential scan of the membership tables.
    const rows = await db.admin<{ indexname: string }>(
      `select indexname from pg_indexes where schemaname = 'public'`,
    );
    const names = rows.map((r) => r.indexname);
    expect(names).toContain('channel_members_user_idx');
    expect(names).toContain('workspace_members_user_idx');
    expect(names).toContain('messages_channel_created_idx');
  });
});

describe('concurrency guards', () => {
  it('takes an advisory lock before the find-or-create window', async () => {
    // The race itself needs two connections, which PGlite does not provide.
    // What is verifiable here is that the lock is actually taken, and that
    // the function still behaves correctly with it in place.
    const src = await db.admin<{ def: string }>(
      `select pg_get_functiondef(p.oid) as def
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'create_dm'`,
    );
    expect(src[0]?.def).toMatch(/pg_advisory_xact_lock/);
  });

  it('still returns the same conversation on a repeated call', async () => {
    const first = await db.as<{ id: string }>(
      alice,
      `select id from public.create_dm($1, $2::uuid[])`,
      [workspace, [bob]],
    );
    const second = await db.as<{ id: string }>(
      alice,
      `select id from public.create_dm($1, $2::uuid[])`,
      [workspace, [bob]],
    );
    expect(second[0]?.id).toBe(first[0]?.id);
  });

  it('treats names that normalise differently as distinct', async () => {
    // "Stand Up" normalises to "stand-up", which is not "standup".
    await db.as(alice, `select public.create_channel($1, 'standup')`, [workspace]);
    const rows = await db.as<{ name: string }>(
      alice,
      `select name from public.create_channel($1, 'Stand Up')`,
      [workspace],
    );
    expect(rows[0]?.name).toBe('stand-up');
  });

  it('rejects a second channel with the same normalised name', async () => {
    await db.as(alice, `select public.create_channel($1, 'release notes')`, [workspace]);
    const error = await expectRejection(() =>
      db.as(alice, `select public.create_channel($1, 'Release   Notes')`, [workspace]),
    );
    expect(error.message).toMatch(/already exists/i);
    expect(error.message).not.toMatch(/duplicate key/i);
  });
});
