import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, expectRejection, type TestDb } from './harness';

/**
 * Adversarial RLS tests.
 *
 * The browser holds the anon key, which is public. There is no trusted client:
 * anything these policies allow, any user can do with curl. Each test asks
 * "what can someone who should not have access actually reach?" rather than
 * "does the happy path work?".
 */

let db: TestDb;

// alice and bob share Acme. carol is an outsider in her own workspace.
let alice: string;
let bob: string;
let carol: string;
let acme: string;
let general: string;
let secret: string; // private channel: alice + bob
let dmAB: string; // direct message: alice <-> bob
let aliceMsg: string; // message by alice in #general

beforeAll(async () => {
  db = await createTestDb();

  alice = await db.createUser('alice@acme.test', { display_name: 'alice' });
  bob = await db.createUser('bob@acme.test', { display_name: 'bob' });
  carol = await db.createUser('carol@other.test', { display_name: 'carol' });

  // Alice builds Acme and brings Bob in.
  const ws = await db.as<{ id: string }>(alice, `select id from public.create_workspace('Acme')`);
  acme = ws[0]!.id;

  await db.admin(
    `insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'member')`,
    [acme, bob],
  );

  const gen = await db.as<{ id: string }>(
    alice,
    `select id from public.channels where workspace_id = $1 and name = 'general'`,
    [acme],
  );
  general = gen[0]!.id;
  await db.admin(`insert into public.channel_members (channel_id, user_id) values ($1, $2)`, [
    general,
    bob,
  ]);

  const priv = await db.as<{ id: string }>(
    alice,
    `select id from public.create_channel($1, 'secret-plans', 'private'::channel_type)`,
    [acme],
  );
  secret = priv[0]!.id;
  await db.admin(`insert into public.channel_members (channel_id, user_id) values ($1, $2)`, [
    secret,
    bob,
  ]);

  const dm = await db.as<{ id: string }>(alice, `select id from public.create_dm($1, $2::uuid[])`, [
    acme,
    [bob],
  ]);
  dmAB = dm[0]!.id;

  const msg = await db.as<{ id: string }>(
    alice,
    `insert into public.messages (channel_id, user_id, body) values ($1, $2, 'hello acme') returning id`,
    [general, alice],
  );
  aliceMsg = msg[0]!.id;

  // Carol lives entirely elsewhere.
  await db.as(carol, `select id from public.create_workspace('Carol Co')`);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe('anonymous visitors', () => {
  it('cannot read any table', async () => {
    for (const table of [
      'profiles',
      'workspaces',
      'workspace_members',
      'channels',
      'channel_members',
      'messages',
      'message_reactions',
      'attachments',
    ]) {
      // Either the grant is absent (throws) or RLS yields zero rows. Both are
      // acceptable; leaking a row is not.
      try {
        const rows = await db.anon(`select * from public.${table}`);
        expect(rows, `anon could read ${table}`).toHaveLength(0);
      } catch (error) {
        expect(String(error)).toMatch(/permission denied/i);
      }
    }
  });

  it('cannot write a message', async () => {
    const error = await expectRejection(() =>
      db.anon(`insert into public.messages (channel_id, user_id, body) values ($1, $2, 'spam')`, [
        general,
        alice,
      ]),
    );
    expect(error.message).toMatch(/permission denied|violates row-level security/i);
  });
});

describe('workspace isolation', () => {
  it('hides workspaces you do not belong to', async () => {
    const rows = await db.as<{ name: string }>(carol, `select name from public.workspaces`);
    expect(rows.map((r) => r.name)).toEqual(['Carol Co']);
  });

  it('hides the member roster of other workspaces', async () => {
    const rows = await db.as(carol, `select * from public.workspace_members where workspace_id = $1`, [
      acme,
    ]);
    expect(rows).toHaveLength(0);
  });

  it('refuses to create a workspace attributed to someone else', async () => {
    const error = await expectRejection(() =>
      db.as(
        carol,
        `insert into public.workspaces (name, initials, created_by) values ('Forged', 'FG', $1)`,
        [alice],
      ),
    );
    expect(error.message).toMatch(/row-level security/i);
  });

  it('refuses to add yourself to someone else\'s workspace', async () => {
    const error = await expectRejection(() =>
      db.as(
        carol,
        `insert into public.workspace_members (workspace_id, user_id) values ($1, $2)`,
        [acme, carol],
      ),
    );
    expect(error.message).toMatch(/row-level security/i);
  });
});

describe('channel visibility', () => {
  it('shows public channels to workspace members who have not joined', async () => {
    const extra = await db.createUser('dave@acme.test', { display_name: 'dave' });
    await db.admin(
      `insert into public.workspace_members (workspace_id, user_id) values ($1, $2)`,
      [acme, extra],
    );
    const rows = await db.as<{ name: string }>(
      extra,
      `select name from public.channels where workspace_id = $1 order by name`,
      [acme],
    );
    // #general is discoverable so it can be joined; the private channel is not.
    expect(rows.map((r) => r.name)).toEqual(['general']);
  });

  it('hides private channels from non-members', async () => {
    const rows = await db.as(carol, `select * from public.channels where id = $1`, [secret]);
    expect(rows).toHaveLength(0);
  });

  it('hides direct messages from everyone outside them', async () => {
    const rows = await db.as(carol, `select * from public.channels where id = $1`, [dmAB]);
    expect(rows).toHaveLength(0);
  });

  it('refuses to create a channel in a workspace you are not in', async () => {
    const error = await expectRejection(() =>
      db.as(carol, `select public.create_channel($1, 'intruder')`, [acme]),
    );
    expect(error.message).toMatch(/not a member of this workspace/i);
  });
});

describe('message confidentiality', () => {
  it('hides messages from users who have not joined the channel', async () => {
    const outsider = await db.createUser('erin@acme.test', { display_name: 'erin' });
    await db.admin(
      `insert into public.workspace_members (workspace_id, user_id) values ($1, $2)`,
      [acme, outsider],
    );
    // Erin can see that #general exists, but not read it until she joins.
    const visible = await db.as(outsider, `select id from public.channels where id = $1`, [general]);
    expect(visible).toHaveLength(1);

    const messages = await db.as(outsider, `select * from public.messages where channel_id = $1`, [
      general,
    ]);
    expect(messages).toHaveLength(0);
  });

  it('hides messages from a different workspace entirely', async () => {
    const rows = await db.as(carol, `select * from public.messages`);
    expect(rows).toHaveLength(0);
  });

  it('refuses to post as another user', async () => {
    const error = await expectRejection(() =>
      db.as(bob, `insert into public.messages (channel_id, user_id, body) values ($1, $2, 'forged')`, [
        general,
        alice,
      ]),
    );
    expect(error.message).toMatch(/row-level security/i);
  });

  it('refuses to post into a channel you have not joined', async () => {
    const error = await expectRejection(() =>
      db.as(carol, `insert into public.messages (channel_id, user_id, body) values ($1, $2, 'hi')`, [
        general,
        carol,
      ]),
    );
    expect(error.message).toMatch(/row-level security/i);
  });

  it('refuses to edit someone else\'s message', async () => {
    const changed = await db.as(
      bob,
      `update public.messages set body = 'tampered' where id = $1 returning id`,
      [aliceMsg],
    );
    // RLS filters the row out, so the update matches nothing rather than erroring.
    expect(changed).toHaveLength(0);

    const check = await db.admin<{ body: string }>(
      `select body from public.messages where id = $1`,
      [aliceMsg],
    );
    expect(check[0]?.body).toBe('hello acme');
  });

  it('refuses to delete someone else\'s message', async () => {
    const deleted = await db.as(bob, `delete from public.messages where id = $1 returning id`, [
      aliceMsg,
    ]);
    expect(deleted).toHaveLength(0);
  });

  it('refuses to reassign a message to another author', async () => {
    const own = await db.as<{ id: string }>(
      bob,
      `insert into public.messages (channel_id, user_id, body) values ($1, $2, 'bob here') returning id`,
      [general, bob],
    );
    const error = await expectRejection(() =>
      db.as(bob, `update public.messages set user_id = $1 where id = $2`, [alice, own[0]!.id]),
    );
    expect(error.message).toMatch(/row-level security/i);
  });
});

describe('reactions', () => {
  it('refuses to react on behalf of another user', async () => {
    const error = await expectRejection(() =>
      db.as(
        bob,
        `insert into public.message_reactions (message_id, user_id, emoji) values ($1, $2, '👍')`,
        [aliceMsg, alice],
      ),
    );
    expect(error.message).toMatch(/row-level security/i);
  });

  it('refuses to react to a message you cannot see', async () => {
    const error = await expectRejection(() =>
      db.as(carol, `select public.toggle_reaction($1, '👍')`, [aliceMsg]),
    );
    expect(error.message).toMatch(/message not found/i);
  });

  it('toggles cleanly and cannot double-count', async () => {
    const added = await db.as<{ toggle_reaction: boolean }>(
      bob,
      `select public.toggle_reaction($1, '🎉') as toggle_reaction`,
      [aliceMsg],
    );
    expect(added[0]?.toggle_reaction).toBe(true);

    const removed = await db.as<{ toggle_reaction: boolean }>(
      bob,
      `select public.toggle_reaction($1, '🎉') as toggle_reaction`,
      [aliceMsg],
    );
    expect(removed[0]?.toggle_reaction).toBe(false);

    const count = await db.admin<{ n: number }>(
      `select count(*)::int as n from public.message_reactions where message_id = $1`,
      [aliceMsg],
    );
    expect(count[0]?.n).toBe(0);
  });
});

describe('read state', () => {
  it('refuses to move another user\'s read marker', async () => {
    const changed = await db.as(
      bob,
      `update public.channel_members set last_read_at = now() - interval '10 years'
        where channel_id = $1 and user_id = $2 returning user_id`,
      [general, alice],
    );
    expect(changed).toHaveLength(0);
  });
});

describe('direct messages', () => {
  it('refuses to start a DM with someone outside the workspace', async () => {
    const error = await expectRejection(() =>
      db.as(alice, `select public.create_dm($1, $2::uuid[])`, [acme, [carol]]),
    );
    expect(error.message).toMatch(/member of the workspace/i);
  });

  it('returns the existing conversation instead of creating a duplicate', async () => {
    const again = await db.as<{ id: string }>(alice, `select id from public.create_dm($1, $2::uuid[])`, [
      acme,
      [bob],
    ]);
    expect(again[0]?.id).toBe(dmAB);

    // And the reverse direction resolves to the same conversation.
    const fromBob = await db.as<{ id: string }>(
      bob,
      `select id from public.create_dm($1, $2::uuid[])`,
      [acme, [alice]],
    );
    expect(fromBob[0]?.id).toBe(dmAB);
  });
});

describe('search and unread counts', () => {
  it('search never returns messages from channels you are not in', async () => {
    await db.as(
      alice,
      `insert into public.messages (channel_id, user_id, body) values ($1, $2, 'classified blueprint')`,
      [secret, alice],
    );

    const asAlice = await db.as<{ body: string }>(
      alice,
      `select body from public.search_messages($1, 'blueprint')`,
      [acme],
    );
    expect(asAlice.map((r) => r.body)).toContain('classified blueprint');

    const asCarol = await db.as(carol, `select * from public.search_messages($1, 'blueprint')`, [acme]);
    expect(asCarol).toHaveLength(0);
  });

  it('unread counts cover only your own channels', async () => {
    const rows = await db.as<{ channel_id: string }>(
      carol,
      `select channel_id from public.unread_counts($1)`,
      [acme],
    );
    expect(rows).toHaveLength(0);
  });

  it('counts unread messages from others and ignores your own', async () => {
    await db.as(bob, `select public.mark_channel_read($1)`, [general]);
    await db.as(bob, `insert into public.messages (channel_id, user_id, body) values ($1,$2,'mine')`, [
      general,
      bob,
    ]);
    await db.as(
      alice,
      `insert into public.messages (channel_id, user_id, body) values ($1,$2,'from alice')`,
      [general, alice],
    );

    const rows = await db.as<{ channel_id: string; unread_count: string }>(
      bob,
      `select channel_id, unread_count from public.unread_counts($1)`,
      [acme],
    );
    const generalRow = rows.find((r) => r.channel_id === general);
    expect(Number(generalRow?.unread_count)).toBe(1);
  });

  it('flags a mention of you', async () => {
    await db.as(bob, `select public.mark_channel_read($1)`, [general]);
    await db.as(
      alice,
      `insert into public.messages (channel_id, user_id, body) values ($1,$2,'ping @bob please')`,
      [general, alice],
    );

    const rows = await db.as<{ channel_id: string; has_mention: boolean }>(
      bob,
      `select channel_id, has_mention from public.unread_counts($1)`,
      [acme],
    );
    expect(rows.find((r) => r.channel_id === general)?.has_mention).toBe(true);
  });
});
