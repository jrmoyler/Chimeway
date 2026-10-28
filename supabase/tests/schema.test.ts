import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, expectRejection, type TestDb } from './harness';

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe('migrations', () => {
  it('apply cleanly and create the expected tables', async () => {
    const rows = await db.admin<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'
        order by table_name`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      'ai_requests',
      'attachments',
      'channel_members',
      'channels',
      'message_reactions',
      'messages',
      'profiles',
      'workspace_members',
      'workspaces',
    ]);
  });

  it('enables row level security on every public table', async () => {
    const rows = await db.admin<{ tablename: string; rowsecurity: boolean }>(
      `select tablename, rowsecurity from pg_tables where schemaname = 'public'`,
    );
    const unprotected = rows.filter((r) => !r.rowsecurity).map((r) => r.tablename);
    expect(unprotected).toEqual([]);
  });

  it('pins search_path on every SECURITY DEFINER function', async () => {
    // A definer-rights function without a pinned search_path is a standard
    // privilege-escalation vector.
    const rows = await db.admin<{ name: string; config: string[] | null }>(
      `select p.proname as name, p.proconfig as config
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'app')
          and p.prosecdef`,
    );
    expect(rows.length).toBeGreaterThan(0);
    const unpinned = rows
      .filter((r) => !(r.config ?? []).some((c) => c.startsWith('search_path=')))
      .map((r) => r.name);
    expect(unpinned).toEqual([]);
  });
});

describe('profile provisioning', () => {
  it('creates a profile automatically on signup', async () => {
    const id = await db.createUser('ada.lovelace@example.com');
    const rows = await db.admin<{ display_name: string; full_name: string }>(
      `select display_name, full_name from public.profiles where id = $1`,
      [id],
    );
    expect(rows[0]?.display_name).toBe('ada.lovelace');
    expect(rows[0]?.full_name).toBe('Ada Lovelace');
  });

  it('honours a display name supplied at signup', async () => {
    const id = await db.createUser('x@example.com', { display_name: 'grace', full_name: 'Grace H' });
    const rows = await db.admin<{ display_name: string; full_name: string }>(
      `select display_name, full_name from public.profiles where id = $1`,
      [id],
    );
    expect(rows[0]?.display_name).toBe('grace');
    expect(rows[0]?.full_name).toBe('Grace H');
  });

  it('de-duplicates handles rather than failing the signup', async () => {
    const a = await db.createUser('dup@one.example.com', { display_name: 'taken' });
    const b = await db.createUser('dup@two.example.com', { display_name: 'taken' });
    const rows = await db.admin<{ id: string; display_name: string }>(
      `select id, display_name from public.profiles where id = any($1::uuid[]) order by display_name`,
      [[a, b]],
    );
    expect(rows.map((r) => r.display_name)).toEqual(['taken', 'taken1']);
  });

  it('rejects an invalid handle format', async () => {
    const id = await db.createUser('weird@example.com');
    const error = await expectRejection(() =>
      db.admin(`update public.profiles set display_name = 'Has Spaces' where id = $1`, [id]),
    );
    expect(error.message).toMatch(/profiles_display_name_format/);
  });
});

describe('message integrity', () => {
  it('refuses a reply to a reply (threads are one level deep)', async () => {
    const owner = await db.createUser('threads@example.com');
    const ws = await db.as<{ id: string }>(owner, `select id from public.create_workspace('T')`);
    const channel = await db.as<{ id: string }>(
      owner,
      `select id from public.channels where workspace_id = $1 limit 1`,
      [ws[0]!.id],
    );

    const root = await db.as<{ id: string }>(
      owner,
      `insert into public.messages (channel_id, user_id, body) values ($1, $2, 'root') returning id`,
      [channel[0]!.id, owner],
    );
    const reply = await db.as<{ id: string }>(
      owner,
      `insert into public.messages (channel_id, parent_id, user_id, body)
       values ($1, $2, $3, 'reply') returning id`,
      [channel[0]!.id, root[0]!.id, owner],
    );

    const error = await expectRejection(() =>
      db.as(
        owner,
        `insert into public.messages (channel_id, parent_id, user_id, body)
         values ($1, $2, $3, 'nested')`,
        [channel[0]!.id, reply[0]!.id, owner],
      ),
    );
    expect(error.message).toMatch(/one level deep/);
  });

  it('refuses a reply in a different channel from its parent', async () => {
    const owner = await db.createUser('xchannel@example.com');
    const ws = await db.as<{ id: string }>(owner, `select id from public.create_workspace('X')`);
    const first = await db.as<{ id: string }>(
      owner,
      `select id from public.channels where workspace_id = $1 limit 1`,
      [ws[0]!.id],
    );
    const second = await db.as<{ id: string }>(
      owner,
      `select id from public.create_channel($1, 'other')`,
      [ws[0]!.id],
    );
    const root = await db.as<{ id: string }>(
      owner,
      `insert into public.messages (channel_id, user_id, body) values ($1, $2, 'root') returning id`,
      [first[0]!.id, owner],
    );

    const error = await expectRejection(() =>
      db.as(
        owner,
        `insert into public.messages (channel_id, parent_id, user_id, body)
         values ($1, $2, $3, 'wrong channel')`,
        [second[0]!.id, root[0]!.id, owner],
      ),
    );
    expect(error.message).toMatch(/same channel/);
  });

  it('stamps edited_at only when the body actually changes', async () => {
    const owner = await db.createUser('edits@example.com');
    const ws = await db.as<{ id: string }>(owner, `select id from public.create_workspace('E')`);
    const ch = await db.as<{ id: string }>(
      owner,
      `select id from public.channels where workspace_id = $1 limit 1`,
      [ws[0]!.id],
    );
    const msg = await db.as<{ id: string }>(
      owner,
      `insert into public.messages (channel_id, user_id, body) values ($1, $2, 'first') returning id`,
      [ch[0]!.id, owner],
    );

    await db.as(owner, `update public.messages set body = 'first' where id = $1`, [msg[0]!.id]);
    let rows = await db.admin<{ edited_at: string | null }>(
      `select edited_at from public.messages where id = $1`,
      [msg[0]!.id],
    );
    expect(rows[0]?.edited_at).toBeNull();

    await db.as(owner, `update public.messages set body = 'second' where id = $1`, [msg[0]!.id]);
    rows = await db.admin<{ edited_at: string | null }>(
      `select edited_at from public.messages where id = $1`,
      [msg[0]!.id],
    );
    expect(rows[0]?.edited_at).not.toBeNull();
  });

  it('cascades replies, reactions and attachments when a root is deleted', async () => {
    const owner = await db.createUser('cascade@example.com');
    const ws = await db.as<{ id: string }>(owner, `select id from public.create_workspace('C')`);
    const ch = await db.as<{ id: string }>(
      owner,
      `select id from public.channels where workspace_id = $1 limit 1`,
      [ws[0]!.id],
    );
    const root = await db.as<{ id: string }>(
      owner,
      `insert into public.messages (channel_id, user_id, body) values ($1, $2, 'root') returning id`,
      [ch[0]!.id, owner],
    );
    await db.as(
      owner,
      `insert into public.messages (channel_id, parent_id, user_id, body) values ($1, $2, $3, 'r1')`,
      [ch[0]!.id, root[0]!.id, owner],
    );
    await db.as(owner, `select public.toggle_reaction($1, '👍')`, [root[0]!.id]);
    await db.as(
      owner,
      `insert into public.attachments (message_id, storage_path, name, mime_type, size_bytes)
       values ($1, 'p/1', 'a.png', 'image/png', 10)`,
      [root[0]!.id],
    );

    await db.as(owner, `delete from public.messages where id = $1`, [root[0]!.id]);

    // Scoped to this channel: the database is shared across tests in the file.
    const counts = await db.admin<{ messages: number; reactions: number; attachments: number }>(
      `select
         (select count(*) from public.messages where channel_id = $1)::int as messages,
         (select count(*) from public.message_reactions r
            join public.messages m on m.id = r.message_id
           where m.channel_id = $1)::int as reactions,
         (select count(*) from public.attachments a
            join public.messages m on m.id = a.message_id
           where m.channel_id = $1)::int as attachments`,
      [ch[0]!.id],
    );
    expect(counts[0]).toEqual({ messages: 0, reactions: 0, attachments: 0 });
  });
});

describe('AI rate limiting', () => {
  it('counts down and then refuses further requests', async () => {
    const user = await db.createUser('ai@example.com', { display_name: 'aiuser' });

    let remaining = -1;
    for (let i = 0; i < 30; i += 1) {
      const rows = await db.as<{ record_ai_request: number }>(
        user,
        `select public.record_ai_request('channel_recap') as record_ai_request`,
      );
      remaining = rows[0]!.record_ai_request;
    }
    expect(remaining).toBe(0);

    const error = await expectRejection(() =>
      db.as(user, `select public.record_ai_request('channel_recap')`),
    );
    expect(error.message).toMatch(/limit reached/i);
  });

  it('rejects an unknown request kind', async () => {
    const user = await db.createUser('ai2@example.com', { display_name: 'aiuser2' });
    const error = await expectRejection(() =>
      db.as(user, `select public.record_ai_request('free_form_prompt')`),
    );
    expect(error.message).toMatch(/unknown request kind/i);
  });

  it('keeps one user\'s usage private from another', async () => {
    const a = await db.createUser('ai3@example.com', { display_name: 'aiuser3' });
    const b = await db.createUser('ai4@example.com', { display_name: 'aiuser4' });
    await db.as(a, `select public.record_ai_request('thread_summary')`);

    const seenByB = await db.as(b, `select * from public.ai_requests`);
    expect(seenByB).toHaveLength(0);
  });
});
