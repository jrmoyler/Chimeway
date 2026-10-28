-- AI request accounting.
--
-- The edge function holds a Gemini key and every call costs money, so an
-- authenticated user must not be able to spend it without bound. The limit
-- lives in the database rather than in the function so it survives cold
-- starts and holds across however many function instances are running.

create table public.ai_requests (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references public.profiles (id) on delete cascade,
  kind       text        not null,
  created_at timestamptz not null default now(),

  constraint ai_requests_kind_check check (kind in ('channel_recap', 'thread_summary'))
);

create index ai_requests_user_time_idx on public.ai_requests (user_id, created_at desc);

alter table public.ai_requests enable row level security;

grant select on public.ai_requests to authenticated;

-- You can see your own usage; writes happen only through the RPC below.
create policy ai_requests_select_own
  on public.ai_requests for select
  to authenticated
  using (user_id = auth.uid());

-- Records a request and rejects it when the caller is over quota. Returns the
-- number remaining in the current window so the UI can warn before the wall.
create or replace function public.record_ai_request(p_kind text)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user    uuid := auth.uid();
  v_window  interval := interval '1 hour';
  v_max     int := 30;
  v_used    int;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if p_kind not in ('channel_recap', 'thread_summary') then
    raise exception 'unknown request kind' using errcode = '22023';
  end if;

  select count(*)
    into v_used
    from public.ai_requests
   where user_id = v_user
     and created_at > now() - v_window;

  if v_used >= v_max then
    raise exception 'AI request limit reached: % per hour', v_max
      using errcode = '53400';
  end if;

  insert into public.ai_requests (user_id, kind) values (v_user, p_kind);

  return v_max - v_used - 1;
end;
$$;

revoke all on function public.record_ai_request(text) from public, anon;
grant execute on function public.record_ai_request(text) to authenticated;
