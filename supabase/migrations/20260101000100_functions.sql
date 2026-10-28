-- Helper functions, triggers, and RPCs.
--
-- Every SECURITY DEFINER function pins `search_path`. Without that, a caller
-- who can create objects in a schema earlier on the path could shadow a table
-- or operator the function body references and have it run with the owner's
-- privileges. This is the standard privilege-escalation route against
-- definer-rights functions and is not optional.

create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Membership predicates
--
-- These are SECURITY DEFINER specifically so they bypass RLS. A policy on
-- `channels` that reads `channel_members` would otherwise invoke that table's
-- own policy, which reads `channels`, and Postgres would recurse until it
-- errors with "infinite recursion detected in policy". Reading membership
-- with definer rights breaks that cycle.
-- ---------------------------------------------------------------------------

create or replace function app.is_workspace_member(target_workspace uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.workspace_members
     where workspace_id = target_workspace
       and user_id = auth.uid()
  );
$$;

create or replace function app.is_channel_member(target_channel uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.channel_members
     where channel_id = target_channel
       and user_id = auth.uid()
  );
$$;

-- Visible = you belong to the workspace, and the channel is either public
-- (discoverable so you can join it) or one you are already a member of.
create or replace function app.can_see_channel(target_channel uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.channels c
      join public.workspace_members wm
        on wm.workspace_id = c.workspace_id
       and wm.user_id = auth.uid()
     where c.id = target_channel
       and (
         c.type = 'public'
         or exists (
           select 1
             from public.channel_members cm
            where cm.channel_id = c.id
              and cm.user_id = auth.uid()
         )
       )
  );
$$;

-- Whether the current user may read a message, used by reaction and
-- attachment policies so they cannot leak content from channels you cannot see.
create or replace function app.can_see_message(target_message uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.messages m
      join public.channel_members cm
        on cm.channel_id = m.channel_id
       and cm.user_id = auth.uid()
     where m.id = target_message
  );
$$;

revoke all on function app.is_workspace_member(uuid) from public;
revoke all on function app.is_channel_member(uuid)   from public;
revoke all on function app.can_see_channel(uuid)     from public;
revoke all on function app.can_see_message(uuid)     from public;
grant execute on function app.is_workspace_member(uuid) to authenticated;
grant execute on function app.is_channel_member(uuid)   to authenticated;
grant execute on function app.can_see_channel(uuid)     to authenticated;
grant execute on function app.can_see_message(uuid)     to authenticated;

-- ---------------------------------------------------------------------------
-- Profile provisioning on signup
-- ---------------------------------------------------------------------------

-- Derives a unique, valid handle from an email local part, appending a counter
-- only when needed. Runs inside the signup transaction.
create or replace function app.generate_display_name(seed text)
returns text
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  base      text;
  candidate text;
  suffix    int := 0;
begin
  base := lower(regexp_replace(coalesce(seed, ''), '[^a-zA-Z0-9._-]', '', 'g'));
  base := regexp_replace(base, '^[._-]+', '');

  if char_length(base) < 2 then
    base := 'user';
  end if;

  base := left(base, 24);
  candidate := base;

  while exists (select 1 from public.profiles where lower(display_name) = candidate) loop
    suffix := suffix + 1;
    candidate := left(base, 24) || suffix::text;
  end loop;

  return candidate;
end;
$$;

create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  meta_full_name text := nullif(trim(new.raw_user_meta_data ->> 'full_name'), '');
  email_local    text := split_part(coalesce(new.email, ''), '@', 1);
begin
  insert into public.profiles (id, full_name, display_name)
  values (
    new.id,
    coalesce(meta_full_name, initcap(replace(email_local, '.', ' ')), 'New user'),
    app.generate_display_name(coalesce(new.raw_user_meta_data ->> 'display_name', email_local))
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function app.touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Message integrity
-- ---------------------------------------------------------------------------

-- Threads are one level deep, and a reply must live in the same channel as
-- its root. Enforced in a trigger because a CHECK constraint cannot query
-- another row.
create or replace function app.validate_message_parent()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  parent_channel uuid;
  parent_parent  uuid;
begin
  if new.parent_id is null then
    return new;
  end if;

  select channel_id, parent_id
    into parent_channel, parent_parent
    from public.messages
   where id = new.parent_id;

  if parent_channel is null then
    raise exception 'parent message % does not exist', new.parent_id
      using errcode = 'foreign_key_violation';
  end if;

  if parent_parent is not null then
    raise exception 'cannot reply to a reply: threads are one level deep'
      using errcode = 'check_violation';
  end if;

  if parent_channel <> new.channel_id then
    raise exception 'a reply must be in the same channel as its parent'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger messages_validate_parent
  before insert or update of parent_id, channel_id on public.messages
  for each row execute function app.validate_message_parent();

-- A message must have either text or at least one attachment. Attachments are
-- inserted after the message, so this is checked on the attachment side and by
-- the send RPC rather than as a column constraint.
create or replace function app.touch_message_edited_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.body is distinct from old.body then
    new.edited_at := now();
  end if;
  return new;
end;
$$;

create trigger messages_touch_edited_at
  before update of body on public.messages
  for each row execute function app.touch_message_edited_at();
