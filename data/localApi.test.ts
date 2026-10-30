import { beforeEach, describe, expect, it } from 'vitest';
import * as local from './localApi';

async function signedInAsDemo() {
  await local.signIn(local.DEMO_EMAIL, local.DEMO_PASSWORD);
  const [workspace] = await local.fetchWorkspaces();
  const { channels } = await local.fetchChannels(workspace!.id);
  const general = channels.find((c) => c.name === 'general')!;
  const me = local.getLocalSessionUserId()!;
  return { workspace: workspace!, general, me };
}

describe('local mode backend', () => {
  beforeEach(() => {
    localStorage.clear();
    local.resetLocalCache();
  });

  it('seeds a demo workspace the demo account can sign in to', async () => {
    const { workspace, general } = await signedInAsDemo();
    expect(workspace.name).toBe('Acme Inc.');
    const messages = await local.fetchMessages(general.id);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]!.reactions[0]?.emoji).toBe('👋');
  });

  it('rejects a wrong password with the same message as an unknown account', async () => {
    await expect(local.signIn(local.DEMO_EMAIL, 'nope-nope')).rejects.toThrow('Invalid login credentials');
    await expect(local.signIn('who@example.com', 'whatever1')).rejects.toThrow('Invalid login credentials');
  });

  it('signs a new account in and joins it to the public channels', async () => {
    const result = await local.signUp('new.person@example.com', 'password123', 'New Person');
    expect(result.needsConfirmation).toBe(false);
    expect(local.getLocalSessionUserId()).not.toBeNull();

    const [workspace] = await local.fetchWorkspaces();
    const { channels } = await local.fetchChannels(workspace!.id);
    expect(channels.map((c) => c.name).sort()).toEqual(['general', 'random']);

    await expect(local.signUp('new.person@example.com', 'password123', 'Again')).rejects.toThrow(
      /already exists/,
    );
  });

  it('persists messages across a reload', async () => {
    const { general, me } = await signedInAsDemo();
    const sent = await local.sendMessage({ channelId: general.id, parentId: null, userId: me, text: 'hello' });

    local.resetLocalCache();
    const messages = await local.fetchMessages(general.id);
    expect(messages.some((m) => m.id === sent.id && m.text === 'hello')).toBe(true);
  });

  it('only lets people edit and delete their own messages', async () => {
    const { general } = await signedInAsDemo();
    const someoneElses = (await local.fetchMessages(general.id))[0]!;
    await expect(local.editMessage(someoneElses.id, 'hijacked')).rejects.toThrow(/your own/);
    await expect(local.deleteMessage(someoneElses.id)).rejects.toThrow(/your own/);
  });

  it('deletes replies along with their root', async () => {
    const { general, me } = await signedInAsDemo();
    const root = await local.sendMessage({ channelId: general.id, parentId: null, userId: me, text: 'root' });
    await local.sendMessage({ channelId: general.id, parentId: root.id, userId: me, text: 'reply' });

    await local.deleteMessage(root.id);
    const remaining = await local.fetchMessages(general.id);
    expect(remaining.some((m) => m.id === root.id || m.parentId === root.id)).toBe(false);
  });

  it('toggles reactions on and off', async () => {
    const { general } = await signedInAsDemo();
    const message = (await local.fetchMessages(general.id))[0]!;
    expect(await local.toggleReaction(message.id, '🎉')).toBe(true);
    expect(await local.toggleReaction(message.id, '🎉')).toBe(false);
  });

  it('counts unread messages from others and spots mentions', async () => {
    const { workspace, general } = await signedInAsDemo();
    // The seeded conversation starts unread, so a first visit shows badges.
    const before = await local.fetchUnreadCounts(workspace.id);
    expect(before.find((r) => r.channel_id === general.id)?.unread_count).toBeGreaterThan(0);

    await local.markChannelRead(general.id);
    const read = await local.fetchUnreadCounts(workspace.id);
    expect(read.find((r) => r.channel_id === general.id)?.unread_count).toBe(0);
    await local.signUp('carol@example.com', 'password123', 'Carol');
    const carol = local.getLocalSessionUserId()!;
    await local.sendMessage({ channelId: general.id, parentId: null, userId: carol, text: 'hey @demo' });

    await local.signIn(local.DEMO_EMAIL, local.DEMO_PASSWORD);
    const after = await local.fetchUnreadCounts(workspace.id);
    expect(after.find((r) => r.channel_id === general.id)).toMatchObject({
      unread_count: 1,
      has_mention: true,
    });
  });

  it('reuses an existing DM between the same people', async () => {
    const { workspace, me } = await signedInAsDemo();
    const other = (await local.fetchProfiles()).find((u) => u.id !== me)!;
    const first = await local.createDm(workspace.id, [other.id]);
    const second = await local.createDm(workspace.id, [other.id]);
    expect(second.id).toBe(first.id);
  });

  it('creates a workspace with a #general channel', async () => {
    await signedInAsDemo();
    const workspace = await local.createWorkspace('Side Project');
    const { channels } = await local.fetchChannels(workspace.id);
    expect(channels.map((c) => c.name)).toEqual(['general']);
  });

  it('searches only channels the user belongs to', async () => {
    const { workspace } = await signedInAsDemo();
    const results = await local.searchMessages(workspace.id, 'lunch');
    expect(results).toHaveLength(1);
  });

  it('reports AI as unavailable rather than failing silently', async () => {
    await expect(
      local.requestAiSummary({ mode: 'channel_recap', channelId: 'x' }),
    ).rejects.toThrow(/local mode/);
  });
});
