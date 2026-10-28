-- Transactional operations exposed to the client.
--
-- These exist because the alternative is several round trips that can fail
-- halfway: a workspace with no owner row, a channel nobody is a member of, or
-- two DMs created for the same pair by a double click. Each runs in one
-- transaction and performs its own authorization check up front - the checks
-- are explicit precisely because SECURITY DEFINER bypasses RLS.

-- ---------------------------------------------------------------------------
-- create_workspace
-- ---------------------------------------------------------------------------

create or replace function public.create_workspace(
  p_name     text,
  p_initials text default null,
  p_color    text default '#1264a3'
)
returns public.workspaces
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user      uuid := auth.uid();
  v_name      text := trim(p_name);
  v_initials  text;
  v_workspace public.workspaces;
  v_channel   uuid;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if char_length(v_name) between 1 and 80 is not true then
    raise exception 'workspace name must be 1-80 characters' using errcode = '22023';
  end if;

  v_initials := upper(coalesce(
    nullif(trim(p_initials), ''),
    left(regexp_replace(v_name, '[^a-zA-Z0-9]', '', 'g'), 2)
  ));
  if v_initials = '' then
    v_initials := 'WS';
  end if;

  insert into public.workspaces (name, initials, color, created_by)
  values (v_name, left(v_initials, 2), coalesce(p_color, '#1264a3'), v_user)
  returning * into v_workspace;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_workspace.id, v_user, 'owner');

  insert into public.channels (workspace_id, type, name, description, created_by)
  values (v_workspace.id, 'public', 'general', 'Workspace-wide announcements and chat.', v_user)
  returning id into v_channel;

  insert into public.channel_members (channel_id, user_id)
  values (v_channel, v_user);

  return v_workspace;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_channel
-- ---------------------------------------------------------------------------

create or replace function public.create_channel(
  p_workspace_id uuid,
  p_name         text,
  p_type         channel_type default 'public',
  p_description  text default ''
)
returns public.channels
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user    uuid := auth.uid();
  v_name    text;
  v_channel public.channels;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if p_type = 'dm' then
    raise exception 'use create_dm to start a direct message' using errcode = '22023';
  end if;

  -- Authorization, stated explicitly because definer rights skip RLS.
  if not app.is_workspace_member(p_workspace_id) then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;

  -- Same normalisation the client previews, applied server-side so it holds
  -- regardless of which client is talking to us.
  v_name := lower(trim(coalesce(p_name, '')));
  v_name := regexp_replace(v_name, '[^a-z0-9 _-]', '', 'g');
  v_name := regexp_replace(v_name, '\s+', '-', 'g');
  v_name := regexp_replace(v_name, '-+', '-', 'g');
  v_name := regexp_replace(v_name, '^-|-$', '', 'g');
  v_name := left(v_name, 80);

  if char_length(v_name) = 0 then
    raise exception 'channel name must contain at least one letter or digit'
      using errcode = '22023';
  end if;

  insert into public.channels (workspace_id, type, name, description, created_by)
  values (p_workspace_id, p_type, v_name, left(coalesce(p_description, ''), 500), v_user)
  returning * into v_channel;

  insert into public.channel_members (channel_id, user_id)
  values (v_channel.id, v_user);

  return v_channel;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_dm
-- ---------------------------------------------------------------------------

-- Returns the existing conversation when one already exists for exactly this
-- set of people, so a double click cannot produce two parallel DM threads.
create or replace function public.create_dm(
  p_workspace_id uuid,
  p_user_ids     uuid[]
)
returns public.channels
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user    uuid := auth.uid();
  v_members uuid[];
  v_channel public.channels;
  v_id      uuid;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not app.is_workspace_member(p_workspace_id) then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;

  -- Always include the caller; de-duplicate and sort for a stable comparison.
  select array_agg(distinct uid order by uid)
    into v_members
    from unnest(array_append(coalesce(p_user_ids, '{}'), v_user)) as uid
   where uid is not null;

  if array_length(v_members, 1) < 2 then
    raise exception 'a direct message needs at least one other person'
      using errcode = '22023';
  end if;

  if array_length(v_members, 1) > 16 then
    raise exception 'a group message supports at most 16 people'
      using errcode = '22023';
  end if;

  -- Everyone invited must themselves belong to the workspace.
  --
  -- The inner NOT EXISTS is safe here specifically because this function is
  -- SECURITY DEFINER, so it sees every membership row. The same shape inside
  -- an RLS *policy* would be a hole: there the subquery is filtered by the
  -- caller's own visibility, and "I can see no members" is not "there are no
  -- members". See the note on workspace_members_insert.
  if exists (
    select 1
      from unnest(v_members) as uid
     where not exists (
       select 1 from public.workspace_members wm
        where wm.workspace_id = p_workspace_id
          and wm.user_id = uid
     )
  ) then
    raise exception 'every participant must be a member of the workspace'
      using errcode = '42501';
  end if;

  -- Find a DM whose member set is exactly this set.
  select c.id
    into v_id
    from public.channels c
   where c.workspace_id = p_workspace_id
     and c.type = 'dm'
     and (
       select array_agg(distinct cm.user_id order by cm.user_id)
         from public.channel_members cm
        where cm.channel_id = c.id
     ) = v_members
   limit 1;

  if v_id is not null then
    select * into v_channel from public.channels where id = v_id;
    return v_channel;
  end if;

  insert into public.channels (workspace_id, type, name, created_by)
  values (p_workspace_id, 'dm', '', v_user)
  returning * into v_channel;

  insert into public.channel_members (channel_id, user_id)
  select v_channel.id, uid from unnest(v_members) as uid;

  return v_channel;
end;
$$;

-- ---------------------------------------------------------------------------
-- toggle_reaction
-- ---------------------------------------------------------------------------

-- One statement rather than read-then-write, so two fast clicks cannot both
-- observe "absent" and both insert.
create or replace function public.toggle_reaction(
  p_message_id uuid,
  p_emoji      text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user    uuid := auth.uid();
  v_deleted int;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not app.can_see_message(p_message_id) then
    raise exception 'message not found' using errcode = '42501';
  end if;

  delete from public.message_reactions
   where message_id = p_message_id
     and user_id = v_user
     and emoji = p_emoji;

  get diagnostics v_deleted = row_count;

  if v_deleted > 0 then
    return false; -- reaction removed
  end if;

  insert into public.message_reactions (message_id, user_id, emoji)
  values (p_message_id, v_user, p_emoji)
  on conflict do nothing;

  return true; -- reaction added
end;
$$;

-- ---------------------------------------------------------------------------
-- mark_channel_read
-- ---------------------------------------------------------------------------

create or replace function public.mark_channel_read(p_channel_id uuid)
returns void
language sql
security invoker
set search_path = public, pg_temp
as $$
  update public.channel_members
     set last_read_at = now()
   where channel_id = p_channel_id
     and user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- unread_counts
-- ---------------------------------------------------------------------------

-- One query for the whole sidebar. Fetching this per channel was the obvious
-- N+1 waiting to happen.
create or replace function public.unread_counts(p_workspace_id uuid)
returns table (
  channel_id   uuid,
  unread_count bigint,
  has_mention  boolean
)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  with me as (
    select auth.uid() as uid
  ),
  my_channels as (
    select cm.channel_id, cm.last_read_at
      from public.channel_members cm
      join public.channels c on c.id = cm.channel_id
      join me on true
     where cm.user_id = me.uid
       and c.workspace_id = p_workspace_id
  ),
  my_handle as (
    select '@' || lower(p.display_name) as handle
      from public.profiles p
      join me on true
     where p.id = me.uid
  )
  select
    mc.channel_id,
    count(m.id) as unread_count,
    coalesce(bool_or(position((select handle from my_handle) in lower(m.body)) > 0), false)
      as has_mention
  from my_channels mc
  left join public.messages m
    on m.channel_id = mc.channel_id
   and m.created_at > mc.last_read_at
   and m.user_id <> (select uid from me)
  group by mc.channel_id;
$$;

-- ---------------------------------------------------------------------------
-- search_messages
-- ---------------------------------------------------------------------------

create or replace function public.search_messages(
  p_workspace_id uuid,
  p_query        text,
  p_limit        int default 50
)
returns table (
  id         uuid,
  channel_id uuid,
  parent_id  uuid,
  user_id    uuid,
  body       text,
  created_at timestamptz,
  rank       real
)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select
    m.id, m.channel_id, m.parent_id, m.user_id, m.body, m.created_at,
    ts_rank(to_tsvector('english', m.body), websearch_to_tsquery('english', p_query)) as rank
  from public.messages m
  join public.channel_members cm
    on cm.channel_id = m.channel_id
   and cm.user_id = auth.uid()
  join public.channels c
    on c.id = m.channel_id
   and c.workspace_id = p_workspace_id
  where char_length(trim(coalesce(p_query, ''))) >= 2
    and (
      to_tsvector('english', m.body) @@ websearch_to_tsquery('english', p_query)
      -- Substring fallback: FTS alone misses partial words, which is exactly
      -- what people type into a search box.
      or m.body ilike '%' || p_query || '%'
    )
  order by rank desc, m.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

-- Expose only to signed-in users.
revoke all on function public.create_workspace(text, text, text) from public, anon;
revoke all on function public.create_channel(uuid, text, channel_type, text) from public, anon;
revoke all on function public.create_dm(uuid, uuid[]) from public, anon;
revoke all on function public.toggle_reaction(uuid, text) from public, anon;
revoke all on function public.mark_channel_read(uuid) from public, anon;
revoke all on function public.unread_counts(uuid) from public, anon;
revoke all on function public.search_messages(uuid, text, int) from public, anon;

grant execute on function public.create_workspace(text, text, text) to authenticated;
grant execute on function public.create_channel(uuid, text, channel_type, text) to authenticated;
grant execute on function public.create_dm(uuid, uuid[]) to authenticated;
grant execute on function public.toggle_reaction(uuid, text) to authenticated;
grant execute on function public.mark_channel_read(uuid) to authenticated;
grant execute on function public.unread_counts(uuid) to authenticated;
grant execute on function public.search_messages(uuid, text, int) to authenticated;
