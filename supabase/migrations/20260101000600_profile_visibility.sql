-- Scope profile visibility to people you actually share a workspace with.
--
-- The original policy was `using (true)`: any authenticated user could read
-- every row in `profiles`. For a single-company deployment that is harmless,
-- but Supabase projects are commonly multi-tenant, and `using (true)` lets
-- anyone who signs up enumerate the full name, handle and avatar of every
-- other user - including those in unrelated organisations.
--
-- Note this only ever exposed profile data; emails live in auth.users, which
-- is never readable by clients.

create or replace function app.shares_workspace(other_user uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.workspace_members mine
      join public.workspace_members theirs
        on theirs.workspace_id = mine.workspace_id
     where mine.user_id = auth.uid()
       and theirs.user_id = other_user
  );
$$;

revoke all on function app.shares_workspace(uuid) from public, anon;
grant execute on function app.shares_workspace(uuid) to authenticated;

drop policy if exists profiles_select_authenticated on public.profiles;

create policy profiles_select_shared_workspace
  on public.profiles for select
  to authenticated
  using (
    id = auth.uid()
    or app.shares_workspace(id)
  );
