-- Row Level Security.
--
-- The browser holds the anon key, which is public by design. RLS is therefore
-- the ONLY thing standing between a user and everyone else's data - there is
-- no trusted client code. Every table below denies by default (RLS enabled
-- with no permissive policy = no access) and is opened only where justified.

-- Revoke the blanket privileges PostgREST roles inherit, then grant narrowly.
revoke all on all tables in schema public from anon, authenticated;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;

grant select, update on public.profiles to authenticated;

-- Any signed-in user can read profiles: names and avatars must render for
-- everyone in a shared channel. Nothing sensitive lives on this table - email
-- stays in auth.users, which is never exposed.
create policy profiles_select_authenticated
  on public.profiles for select
  to authenticated
  using (true);

create policy profiles_update_own
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- No INSERT policy: profiles are created only by the signup trigger, which
-- runs with definer rights. No DELETE policy: profiles die with auth.users.

-- ---------------------------------------------------------------------------
-- workspaces
-- ---------------------------------------------------------------------------

alter table public.workspaces enable row level security;

grant select, insert, update on public.workspaces to authenticated;

create policy workspaces_select_member
  on public.workspaces for select
  to authenticated
  using (app.is_workspace_member(id));

-- You may create a workspace, but only attributed to yourself. The creating
-- RPC adds the owner membership row in the same transaction.
create policy workspaces_insert_self
  on public.workspaces for insert
  to authenticated
  with check (created_by = auth.uid());

create policy workspaces_update_admin
  on public.workspaces for update
  to authenticated
  using (
    exists (
      select 1 from public.workspace_members wm
       where wm.workspace_id = id
         and wm.user_id = auth.uid()
         and wm.role in ('owner', 'admin')
    )
  )
  with check (
    exists (
      select 1 from public.workspace_members wm
       where wm.workspace_id = id
         and wm.user_id = auth.uid()
         and wm.role in ('owner', 'admin')
    )
  );

-- ---------------------------------------------------------------------------
-- workspace_members
-- ---------------------------------------------------------------------------

alter table public.workspace_members enable row level security;

grant select, insert, delete on public.workspace_members to authenticated;

-- You can see the roster of workspaces you belong to.
create policy workspace_members_select
  on public.workspace_members for select
  to authenticated
  using (app.is_workspace_member(workspace_id));

-- Only an existing owner/admin may add someone.
--
-- There is deliberately NO "allow if the workspace has no members yet"
-- bootstrap branch. Such a branch reads `not exists (select ... from
-- workspace_members ...)`, and that subquery is itself filtered by this
-- table's RLS: a stranger sees none of a workspace's members, so `not exists`
-- evaluates TRUE for them and they can insert themselves into any workspace.
-- Bootstrapping is handled by create_workspace(), which runs with definer
-- rights and inserts the owner row in the same transaction.
create policy workspace_members_insert
  on public.workspace_members for insert
  to authenticated
  with check (
    exists (
      select 1 from public.workspace_members wm
       where wm.workspace_id = workspace_members.workspace_id
         and wm.user_id = auth.uid()
         and wm.role in ('owner', 'admin')
    )
  );

-- Leave a workspace yourself, or be removed by an admin.
create policy workspace_members_delete
  on public.workspace_members for delete
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.workspace_members wm
       where wm.workspace_id = workspace_members.workspace_id
         and wm.user_id = auth.uid()
         and wm.role in ('owner', 'admin')
    )
  );

-- ---------------------------------------------------------------------------
-- channels
-- ---------------------------------------------------------------------------

alter table public.channels enable row level security;

grant select, insert, update on public.channels to authenticated;

-- Public channels are discoverable to workspace members so they can be joined.
-- Private channels and DMs require membership.
create policy channels_select_visible
  on public.channels for select
  to authenticated
  using (app.can_see_channel(id));

create policy channels_insert_workspace_member
  on public.channels for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and app.is_workspace_member(workspace_id)
  );

-- Only members may rename or re-describe a channel.
create policy channels_update_member
  on public.channels for update
  to authenticated
  using (app.is_channel_member(id))
  with check (app.is_channel_member(id));

-- ---------------------------------------------------------------------------
-- channel_members
-- ---------------------------------------------------------------------------

alter table public.channel_members enable row level security;

grant select, insert, update, delete on public.channel_members to authenticated;

create policy channel_members_select
  on public.channel_members for select
  to authenticated
  using (app.can_see_channel(channel_id));

-- Join a public channel yourself; otherwise an existing member must add you.
-- DM membership is set up by the create_dm RPC inside one transaction.
create policy channel_members_insert
  on public.channel_members for insert
  to authenticated
  with check (
    (
      user_id = auth.uid()
      and exists (
        select 1 from public.channels c
         where c.id = channel_members.channel_id
           and c.type = 'public'
           and app.is_workspace_member(c.workspace_id)
      )
    )
    or app.is_channel_member(channel_members.channel_id)
  );

-- You may only move your own read marker.
create policy channel_members_update_own
  on public.channel_members for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy channel_members_delete
  on public.channel_members for delete
  to authenticated
  using (user_id = auth.uid() or app.is_channel_member(channel_id));

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------

alter table public.messages enable row level security;

grant select, insert, update, delete on public.messages to authenticated;

-- Membership, not mere visibility: you must have joined a channel to read its
-- messages, so a public channel's contents stay closed until you join.
create policy messages_select_member
  on public.messages for select
  to authenticated
  using (app.is_channel_member(channel_id));

create policy messages_insert_member
  on public.messages for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and app.is_channel_member(channel_id)
  );

-- Authors edit their own messages. `using` and `with check` both pin
-- user_id so a row cannot be edited into someone else's name.
create policy messages_update_own
  on public.messages for update
  to authenticated
  using (user_id = auth.uid() and app.is_channel_member(channel_id))
  with check (user_id = auth.uid() and app.is_channel_member(channel_id));

create policy messages_delete_own
  on public.messages for delete
  to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- message_reactions
-- ---------------------------------------------------------------------------

alter table public.message_reactions enable row level security;

grant select, insert, delete on public.message_reactions to authenticated;

create policy message_reactions_select
  on public.message_reactions for select
  to authenticated
  using (app.can_see_message(message_id));

create policy message_reactions_insert_own
  on public.message_reactions for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and app.can_see_message(message_id)
  );

create policy message_reactions_delete_own
  on public.message_reactions for delete
  to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- attachments
-- ---------------------------------------------------------------------------

alter table public.attachments enable row level security;

grant select, insert, delete on public.attachments to authenticated;

create policy attachments_select
  on public.attachments for select
  to authenticated
  using (app.can_see_message(message_id));

-- Only the message author may attach to it.
create policy attachments_insert_author
  on public.attachments for insert
  to authenticated
  with check (
    exists (
      select 1 from public.messages m
       where m.id = attachments.message_id
         and m.user_id = auth.uid()
    )
  );

create policy attachments_delete_author
  on public.attachments for delete
  to authenticated
  using (
    exists (
      select 1 from public.messages m
       where m.id = attachments.message_id
         and m.user_id = auth.uid()
    )
  );

-- Sequences backing any future serial columns stay closed to clients.
revoke all on all sequences in schema public from anon, authenticated;
