import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, expectRejection, type TestDb } from './harness';

/**
 * Second pass over the policies, looking for privilege escalation rather than
 * plain read leakage: can a member become an admin, write into a channel they
 * only observe, or reach another tenant's user list?
 */

let db: TestDb;
let owner: string;
let member: string;
let stranger: string;
let workspace: string;
let privateChannel: string;
let publicChannel: string;
let ownerMessage: string;

beforeAll(async () => {
  db = await createTestDb();

  owner = await db.createUser('owner@esc.test', { display_name: 'owneresc' });
  member = await db.createUser('member@esc.test', { display_name: 'memberesc' });
  stranger = await db.createUser('stranger@esc.test', { display_name: 'strangeresc' });

  const ws = await db.as<{ id: string }>(owner, `select id from public.create_workspace('Esc')`);
  workspace = ws[0]!.id;

  await db.admin(
    `insert into public.workspace_members (workspace_id, user_id, role) values ($1,$2,'member')`,
    [workspace, member],
  );

  const pub = await db.as<{ id: string }>(
    owner,
    `select id from public.channels where workspace_id = $1 and name = 'general'`,
    [workspace],
  );
  publicChannel = pub[0]!.id;

  const priv = await db.as<{ id: string }>(
    owner,
    `select id from public.create_channel($1, 'locked', 'private'::channel_type)`,
    [workspace],
  );
  privateChannel = priv[0]!.id;

  const msg = await db.as<{ id: string }>(
    owner,
    `insert into public.messages (channel_id, user_id, body) values ($1,$2,'owner only') returning id`,
    [privateChannel, owner],
  );
  ownerMessage = msg[0]!.id;

  // The stranger has their own unrelated workspace.
  await db.as(stranger, `select id from public.create_workspace('Stranger Co')`);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe('role escalation', () => {
  it('a member cannot promote themselves to admin', async () => {
    // UPDATE is never granted on this table, so the attempt is refused before
    // RLS is even consulted - defence in depth rather than a policy filter.
    const error = await expectRejection(() =>
      db.as(
        member,
        `update public.workspace_members set role = 'owner'
          where workspace_id = $1 and user_id = $2`,
        [workspace, member],
      ),
    );
    expect(error.message).toMatch(/permission denied/i);

    const check = await db.admin<{ role: string }>(
      `select role from public.workspace_members where workspace_id=$1 and user_id=$2`,
      [workspace, member],
    );
    expect(check[0]?.role).toBe('member');
  });

  it('a member cannot invite someone into the workspace', async () => {
    const error = await expectRejection(() =>
      db.as(member, `insert into public.workspace_members (workspace_id, user_id) values ($1,$2)`, [
        workspace,
        stranger,
      ]),
    );
    expect(error.message).toMatch(/row-level security/i);
  });

  it('an owner can invite someone', async () => {
    const rows = await db.as<{ user_id: string }>(
      owner,
      `insert into public.workspace_members (workspace_id, user_id) values ($1,$2) returning user_id`,
      [workspace, stranger],
    );
    expect(rows).toHaveLength(1);
    // Clean up so later assertions still treat the stranger as an outsider.
    await db.admin(`delete from public.workspace_members where workspace_id=$1 and user_id=$2`, [
      workspace,
      stranger,
    ]);
  });
});

describe('private channel boundaries', () => {
  it('a workspace member cannot add themselves to a private channel', async () => {
    const error = await expectRejection(() =>
      db.as(member, `insert into public.channel_members (channel_id, user_id) values ($1,$2)`, [
        privateChannel,
        member,
      ]),
    );
    expect(error.message).toMatch(/row-level security/i);
  });

  it('a workspace member may join a public channel', async () => {
    const rows = await db.as<{ user_id: string }>(
      member,
      `insert into public.channel_members (channel_id, user_id) values ($1,$2) returning user_id`,
      [publicChannel, member],
    );
    expect(rows).toHaveLength(1);
  });

  it('an outsider cannot join a public channel in a workspace they are not in', async () => {
    const error = await expectRejection(() =>
      db.as(stranger, `insert into public.channel_members (channel_id, user_id) values ($1,$2)`, [
        publicChannel,
        stranger,
      ]),
    );
    expect(error.message).toMatch(/row-level security/i);
  });

  it('a non-member cannot rename a private channel', async () => {
    const changed = await db.as(
      member,
      `update public.channels set name = 'hijacked' where id = $1 returning id`,
      [privateChannel],
    );
    expect(changed).toHaveLength(0);
  });
});

describe('attachments', () => {
  it('cannot be attached to someone else\'s message', async () => {
    const error = await expectRejection(() =>
      db.as(
        member,
        `insert into public.attachments (message_id, storage_path, name, mime_type, size_bytes)
         values ($1, 'x/1', 'evil.png', 'image/png', 10)`,
        [ownerMessage],
      ),
    );
    expect(error.message).toMatch(/row-level security/i);
  });

  it('cannot exceed the size limit even from a crafted request', async () => {
    const error = await expectRejection(() =>
      db.as(
        owner,
        `insert into public.attachments (message_id, storage_path, name, mime_type, size_bytes)
         values ($1, 'x/huge', 'huge.bin', 'application/octet-stream', $2)`,
        [ownerMessage, 50 * 1024 * 1024],
      ),
    );
    expect(error.message).toMatch(/attachments_size_limit/);
  });
});

describe('AI quota', () => {
  it('cannot be bypassed by inserting usage rows directly', async () => {
    // No INSERT policy exists on ai_requests, so only the RPC can write.
    const error = await expectRejection(() =>
      db.as(member, `insert into public.ai_requests (user_id, kind) values ($1,'channel_recap')`, [
        member,
      ]),
    );
    expect(error.message).toMatch(/row-level security|permission denied/i);
  });

  it('cannot be reset by deleting your own usage rows', async () => {
    await db.as(member, `select public.record_ai_request('channel_recap')`);
    // Only SELECT is granted on ai_requests; a user cannot clear their quota.
    const error = await expectRejection(() =>
      db.as(member, `delete from public.ai_requests`),
    );
    expect(error.message).toMatch(/permission denied/i);
  });
});

describe('cross-tenant profile exposure', () => {
  it('does not expose people from unrelated workspaces', async () => {
    // The stranger shares no workspace with the owner or member.
    const visible = await db.as<{ display_name: string }>(
      stranger,
      `select display_name from public.profiles order by display_name`,
    );
    const names = visible.map((r) => r.display_name);
    expect(names).toContain('strangeresc');
    expect(names).not.toContain('owneresc');
    expect(names).not.toContain('memberesc');
  });

  it('does expose people you share a workspace with', async () => {
    const visible = await db.as<{ display_name: string }>(
      member,
      `select display_name from public.profiles order by display_name`,
    );
    expect(visible.map((r) => r.display_name)).toContain('owneresc');
  });
});
