import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, expectRejection, type TestDb } from './harness';

/**
 * Storage policies are a separate attack surface from table RLS: a file is
 * reachable by its object key, so the only thing stopping an outsider from
 * reading an attachment is the policy on storage.objects.
 */

let db: TestDb;
let alice: string;
let bob: string;
let carol: string;
let privateChannel: string;

beforeAll(async () => {
  db = await createTestDb();

  alice = await db.createUser('alice@s.test', { display_name: 'alices' });
  bob = await db.createUser('bob@s.test', { display_name: 'bobs' });
  carol = await db.createUser('carol@s.test', { display_name: 'carols' });

  const ws = await db.as<{ id: string }>(alice, `select id from public.create_workspace('Store')`);
  await db.admin(`insert into public.workspace_members (workspace_id, user_id) values ($1,$2)`, [
    ws[0]!.id,
    bob,
  ]);
  await db.admin(`insert into public.workspace_members (workspace_id, user_id) values ($1,$2)`, [
    ws[0]!.id,
    carol,
  ]);

  const ch = await db.as<{ id: string }>(
    alice,
    `select id from public.create_channel($1, 'vault', 'private'::channel_type)`,
    [ws[0]!.id],
  );
  privateChannel = ch[0]!.id;
  await db.admin(`insert into public.channel_members (channel_id, user_id) values ($1,$2)`, [
    privateChannel,
    bob,
  ]);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe('attachment bucket', () => {
  it('is private and size-limited', async () => {
    const rows = await db.admin<{ public: boolean; file_size_limit: string }>(
      `select public, file_size_limit from storage.buckets where id = 'attachments'`,
    );
    expect(rows[0]?.public).toBe(false);
    expect(Number(rows[0]?.file_size_limit)).toBe(5 * 1024 * 1024);
  });
});

describe('attachment access', () => {
  it('lets a channel member upload into that channel', async () => {
    const rows = await db.as<{ id: string }>(
      alice,
      `insert into storage.objects (bucket_id, name, owner_id)
       values ('attachments', $1 || '/report.pdf', $2) returning id`,
      [privateChannel, alice],
    );
    expect(rows).toHaveLength(1);
  });

  it('refuses an upload into a channel you are not in', async () => {
    const error = await expectRejection(() =>
      db.as(
        carol,
        `insert into storage.objects (bucket_id, name, owner_id)
         values ('attachments', $1 || '/sneaky.pdf', $2)`,
        [privateChannel, carol],
      ),
    );
    expect(error.message).toMatch(/row-level security/i);
  });

  it('refuses an upload attributed to another user', async () => {
    const error = await expectRejection(() =>
      db.as(
        bob,
        `insert into storage.objects (bucket_id, name, owner_id)
         values ('attachments', $1 || '/forged.pdf', $2)`,
        [privateChannel, alice],
      ),
    );
    expect(error.message).toMatch(/row-level security/i);
  });

  it('lets other channel members read the file', async () => {
    const rows = await db.as(bob, `select name from storage.objects where bucket_id='attachments'`);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('hides the file from users outside the channel', async () => {
    const rows = await db.as(carol, `select name from storage.objects where bucket_id='attachments'`);
    expect(rows).toHaveLength(0);
  });

  it('refuses deletion by someone who did not upload it', async () => {
    const deleted = await db.as(
      bob,
      `delete from storage.objects where bucket_id='attachments' returning id`,
    );
    expect(deleted).toHaveLength(0);
  });

  it('lets the uploader delete their own file', async () => {
    const deleted = await db.as(
      alice,
      `delete from storage.objects where bucket_id='attachments' returning id`,
    );
    expect(deleted.length).toBeGreaterThan(0);
  });
});

describe('realtime publication', () => {
  it('publishes exactly the tables the client subscribes to', async () => {
    const rows = await db.admin<{ tablename: string }>(
      `select tablename from pg_publication_tables
        where pubname = 'supabase_realtime' order by tablename`,
    );
    expect(rows.map((r) => r.tablename)).toEqual([
      'attachments',
      'channel_members',
      'channels',
      'message_reactions',
      'messages',
      'profiles',
    ]);
  });

  it('uses full replica identity so updates and deletes carry their data', async () => {
    // Without this, a realtime UPDATE payload contains only the primary key.
    const rows = await db.admin<{ relname: string; relreplident: string }>(
      `select c.relname, c.relreplident
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname in ('messages','message_reactions','attachments','channel_members','profiles')
        order by c.relname`,
    );
    for (const row of rows) {
      expect(row.relreplident, `${row.relname} replica identity`).toBe('f');
    }
  });
});
