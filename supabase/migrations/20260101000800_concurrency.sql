-- Concurrency hardening.
--
-- create_dm() checks for an existing conversation and then inserts one. Those
-- are two steps: two requests arriving together - a double-clicked button, or
-- both participants opening the same chat at once - can both find nothing and
-- both insert, producing two parallel DM threads for the same people with
-- messages split between them.
--
-- Membership lives in a separate table, so a unique constraint cannot express
-- "one DM per member set". A transaction-scoped advisory lock keyed on the
-- sorted member list serialises just those callers; it is released
-- automatically at commit or rollback.

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

  -- Always include the caller; de-duplicate and sort for a stable comparison
  -- and a stable lock key.
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

  -- Every participant must belong to the workspace.
  --
  -- The NOT EXISTS is safe here because this function is SECURITY DEFINER and
  -- sees every row. The same shape inside an RLS policy would be a hole - see
  -- the note on workspace_members_insert.
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

  -- Serialise concurrent creates for this exact set of people in this
  -- workspace. Held until the transaction ends.
  perform pg_advisory_xact_lock(
    hashtext(p_workspace_id::text || ':' || array_to_string(v_members, ','))
  );

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

revoke all on function public.create_dm(uuid, uuid[]) from public, anon;
grant execute on function public.create_dm(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- A clearer error for a duplicate channel name
--
-- Two people creating #standup at the same moment produced a raw
-- "duplicate key value violates unique constraint" from PostgREST.
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

  begin
    insert into public.channels (workspace_id, type, name, description, created_by)
    values (p_workspace_id, p_type, v_name, left(coalesce(p_description, ''), 500), v_user)
    returning * into v_channel;
  exception when unique_violation then
    raise exception 'a channel named #% already exists in this workspace', v_name
      using errcode = '23505';
  end;

  insert into public.channel_members (channel_id, user_id)
  values (v_channel.id, v_user);

  return v_channel;
end;
$$;

revoke all on function public.create_channel(uuid, text, channel_type, text) from public, anon;
grant execute on function public.create_channel(uuid, text, channel_type, text) to authenticated;
