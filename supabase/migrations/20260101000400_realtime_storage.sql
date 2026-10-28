-- Realtime replication and attachment storage.

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------

-- Supabase Realtime streams changes from this publication. Subscriptions are
-- still filtered by RLS using the subscriber's JWT, so a client cannot listen
-- to a channel it could not read directly.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.message_reactions;
alter publication supabase_realtime add table public.attachments;
alter publication supabase_realtime add table public.channels;
alter publication supabase_realtime add table public.channel_members;
alter publication supabase_realtime add table public.profiles;

-- UPDATE and DELETE events carry only the primary key unless the table has a
-- full replica identity. Without this, an edited message arrives with no body
-- and a deleted one with no channel_id, so subscribers cannot act on either.
alter table public.messages          replica identity full;
alter table public.message_reactions replica identity full;
alter table public.attachments       replica identity full;
alter table public.channel_members   replica identity full;
alter table public.profiles          replica identity full;

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------

-- Attachments live in a private bucket. Access is mediated entirely by the
-- policies below plus short-lived signed URLs; nothing is publicly readable.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments',
  'attachments',
  false,
  5 * 1024 * 1024,
  array[
    'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
    'application/pdf', 'text/plain', 'text/csv', 'text/markdown',
    'application/json', 'application/zip',
    'video/mp4', 'audio/mpeg', 'audio/wav'
  ]
)
on conflict (id) do update
  set file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types,
      public             = excluded.public;

-- Object keys are `<channel_id>/<uuid>-<filename>`, so the first path segment
-- identifies the channel whose membership governs access.
create policy "attachments read for channel members"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'attachments'
    and app.is_channel_member(((storage.foldername(name))[1])::uuid)
  );

create policy "attachments upload for channel members"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'attachments'
    and owner_id = auth.uid()::text
    and app.is_channel_member(((storage.foldername(name))[1])::uuid)
  );

-- Only the uploader may remove a file, matching message deletion.
create policy "attachments delete own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'attachments'
    and owner_id = auth.uid()::text
  );
