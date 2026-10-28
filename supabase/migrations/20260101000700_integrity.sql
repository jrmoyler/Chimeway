-- Integrity fixes found by the second QA pass.
--
-- Each of these is reachable by a correctly authenticated user: row level
-- security decides *who* may write, and says nothing about *what* they may
-- write. These constrain the content itself.

-- ---------------------------------------------------------------------------
-- 1. Server-assigned timestamps
--
-- `created_at` had a DEFAULT but no protection, so a client could supply its
-- own. A forged timestamp reorders history: a message can be made to appear
-- above everything already in a channel, or buried below it.
-- ---------------------------------------------------------------------------

-- Separate functions per table: message_reactions has no edited_at column, so
-- a single shared function that touches it fails at runtime on that table.
create or replace function app.force_message_timestamps()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.edited_at := null;
  else
    -- created_at is immutable once set.
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

create or replace function app.force_created_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.created_at := now();
  return new;
end;
$$;

create trigger messages_force_timestamps
  before insert or update on public.messages
  for each row execute function app.force_message_timestamps();

create trigger reactions_force_timestamps
  before insert on public.message_reactions
  for each row execute function app.force_created_at();

-- ---------------------------------------------------------------------------
-- 2. A message must carry something
--
-- Nothing stopped an empty message, or an edit that emptied one. This cannot
-- be a CHECK constraint: an attachment-only message is inserted with an empty
-- body and its attachments arrive moments later in the same transaction. A
-- DEFERRED constraint trigger evaluates at commit, once both are present.
--
-- Note this forces attachment messages through send_message(): PostgREST runs
-- each request in its own transaction, so an empty insert on its own would
-- (correctly) be rejected at commit.
-- ---------------------------------------------------------------------------

create or replace function app.message_has_content()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- The row may have been deleted later in the same transaction.
  if not exists (select 1 from public.messages where id = new.id) then
    return null;
  end if;

  if btrim(new.body) <> '' then
    return null;
  end if;

  if exists (select 1 from public.attachments where message_id = new.id) then
    return null;
  end if;

  raise exception 'a message must have text or at least one attachment'
    using errcode = 'check_violation';
end;
$$;

create constraint trigger messages_require_content
  after insert or update of body on public.messages
  deferrable initially deferred
  for each row execute function app.message_has_content();

-- ---------------------------------------------------------------------------
-- 3. Account deletion must be possible
--
-- `created_by` was ON DELETE RESTRICT, so deleting a user who had ever created
-- a workspace or channel failed outright - which makes an erasure request
-- impossible to satisfy without hand-editing rows. The workspace should
-- outlive its creator; the attribution is what goes.
-- ---------------------------------------------------------------------------

alter table public.workspaces
  drop constraint workspaces_created_by_fkey,
  alter column created_by drop not null,
  add constraint workspaces_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null;

alter table public.channels
  drop constraint channels_created_by_fkey,
  alter column created_by drop not null,
  add constraint channels_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null;

-- ---------------------------------------------------------------------------
-- 4. Mention detection must respect word boundaries
--
-- `position('@' || handle in body)` is a substring test, so a message naming
-- @alice2 raised a mention for @alice. Every handle that is a prefix of
-- another generated false alerts.
-- ---------------------------------------------------------------------------

-- Handles are constrained to [a-z0-9._-], so '.' is the only regex
-- metacharacter that can appear and needs escaping.
create or replace function app.mention_pattern(handle text)
returns text
language sql
immutable
set search_path = pg_temp
as $$
  select '@' || replace(handle, '.', '\.') || '($|[^a-z0-9._-])';
$$;

grant execute on function app.mention_pattern(text) to authenticated;

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
  my_pattern as (
    select app.mention_pattern(lower(p.display_name)) as pattern
      from public.profiles p
      join me on true
     where p.id = me.uid
  )
  select
    mc.channel_id,
    count(m.id) as unread_count,
    coalesce(bool_or(lower(m.body) ~ (select pattern from my_pattern)), false) as has_mention
  from my_channels mc
  left join public.messages m
    on m.channel_id = mc.channel_id
   and m.created_at > mc.last_read_at
   and m.user_id <> (select uid from me)
  group by mc.channel_id;
$$;

-- ---------------------------------------------------------------------------
-- 5. Search must treat user input as text, not as a pattern
--
-- The ILIKE fallback interpolated the query directly, so a search for "%%"
-- matched every message the caller could read, and "_" matched any character.
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
  with needle as (
    select
      trim(coalesce(p_query, '')) as raw,
      -- Escape the LIKE metacharacters so the query is matched literally.
      '%' || replace(replace(replace(trim(coalesce(p_query, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%'
        as pattern
  )
  select
    m.id, m.channel_id, m.parent_id, m.user_id, m.body, m.created_at,
    ts_rank(to_tsvector('english', m.body), websearch_to_tsquery('english', (select raw from needle)))
      as rank
  from public.messages m
  join public.channel_members cm
    on cm.channel_id = m.channel_id
   and cm.user_id = auth.uid()
  join public.channels c
    on c.id = m.channel_id
   and c.workspace_id = p_workspace_id
  cross join needle
  where char_length(needle.raw) >= 2
    and (
      to_tsvector('english', m.body) @@ websearch_to_tsquery('english', needle.raw)
      -- Substring fallback for partial words, which is what people type.
      or m.body ilike needle.pattern escape '\'
    )
  order by rank desc, m.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

-- ---------------------------------------------------------------------------
-- 6. Atomic send
--
-- Inserting a message and then its attachments as separate requests leaves a
-- window where the message exists without them, and an upload that fails
-- halfway strands storage objects nothing references. One transaction closes
-- both, and satisfies the deferred content constraint above.
-- ---------------------------------------------------------------------------

create or replace function public.send_message(
  p_channel_id  uuid,
  p_body        text,
  p_parent_id   uuid default null,
  p_attachments jsonb default '[]'::jsonb
)
returns public.messages
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user    uuid := auth.uid();
  v_body    text := btrim(coalesce(p_body, ''));
  v_message public.messages;
  v_item    jsonb;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not app.is_channel_member(p_channel_id) then
    raise exception 'not a member of this channel' using errcode = '42501';
  end if;

  if v_body = '' and jsonb_array_length(coalesce(p_attachments, '[]'::jsonb)) = 0 then
    raise exception 'a message must have text or at least one attachment'
      using errcode = '22023';
  end if;

  insert into public.messages (channel_id, parent_id, user_id, body)
  values (p_channel_id, p_parent_id, v_user, left(v_body, 4000))
  returning * into v_message;

  for v_item in select * from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb))
  loop
    insert into public.attachments (message_id, storage_path, name, mime_type, size_bytes)
    values (
      v_message.id,
      v_item ->> 'storage_path',
      left(coalesce(v_item ->> 'name', 'file'), 255),
      coalesce(v_item ->> 'mime_type', 'application/octet-stream'),
      (v_item ->> 'size_bytes')::bigint
    );
  end loop;

  return v_message;
end;
$$;

revoke all on function public.send_message(uuid, text, uuid, jsonb) from public, anon;
grant execute on function public.send_message(uuid, text, uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Index the unfiltered channel read
--
-- The existing index is partial (`where parent_id is null`), which serves the
-- channel view but not the query that loads a channel's messages including
-- thread replies.
-- ---------------------------------------------------------------------------

create index if not exists messages_channel_all_idx
  on public.messages (channel_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 8. Keep AI usage bounded
--
-- The quota only ever reads the last hour, so older rows are dead weight that
-- grows without limit.
-- ---------------------------------------------------------------------------

create or replace function app.prune_ai_requests()
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.ai_requests where created_at < now() - interval '7 days';
$$;

comment on function app.prune_ai_requests() is
  'Run periodically (pg_cron: select cron.schedule(''prune-ai'', ''0 3 * * *'', ''select app.prune_ai_requests()''))';
