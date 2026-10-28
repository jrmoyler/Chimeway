-- Local development seed.
--
-- Runs only against a local `supabase start` database, never production.
-- Creates two confirmed users so you can sign in immediately and see the app
-- with two people in it.
--
--   alice@chimeway.test / password123
--   bob@chimeway.test   / password123
--
-- The passwords are hashed with bcrypt by Supabase's own extension; they are
-- throwaway credentials for a local container.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    'aaaaaaaa-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'alice@chimeway.test',
    crypt('password123', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Alice Nakamura","display_name":"alice"}',
    now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'bbbbbbbb-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'bob@chimeway.test',
    crypt('password123', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Bob Okafor","display_name":"bob"}',
    now(), now()
  )
on conflict (id) do nothing;

insert into auth.identities (
  id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
select
  gen_random_uuid(), u.id, u.id::text,
  format('{"sub":"%s","email":"%s","email_verified":true}', u.id, u.email)::jsonb,
  'email', now(), now(), now()
from auth.users u
where u.email in ('alice@chimeway.test', 'bob@chimeway.test')
on conflict do nothing;

-- Give Alice a workspace with Bob in it and a short conversation.
do $$
declare
  v_alice uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  v_bob   uuid := 'bbbbbbbb-0000-4000-8000-000000000002';
  v_ws    uuid;
  v_gen   uuid;
  v_root  uuid;
begin
  if exists (select 1 from public.workspaces where name = 'Acme Inc.') then
    return;
  end if;

  insert into public.workspaces (name, initials, color, created_by)
  values ('Acme Inc.', 'AI', '#1264a3', v_alice)
  returning id into v_ws;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_ws, v_alice, 'owner'), (v_ws, v_bob, 'member');

  insert into public.channels (workspace_id, type, name, description, created_by)
  values (v_ws, 'public', 'general', 'Company-wide announcements and chat.', v_alice)
  returning id into v_gen;

  insert into public.channel_members (channel_id, user_id)
  values (v_gen, v_alice), (v_gen, v_bob);

  insert into public.messages (channel_id, user_id, body, created_at)
  values (v_gen, v_alice, 'Welcome to Chimeway. 🎉', now() - interval '2 hours')
  returning id into v_root;

  insert into public.messages (channel_id, user_id, body, created_at)
  values
    (v_gen, v_bob, 'Glad to be here.', now() - interval '110 minutes'),
    (v_gen, v_alice, 'Threads work now - try replying to this one.', now() - interval '90 minutes');

  insert into public.messages (channel_id, parent_id, user_id, body, created_at)
  values (v_gen, v_root, v_bob, 'Testing a thread reply.', now() - interval '80 minutes');

  insert into public.message_reactions (message_id, user_id, emoji)
  values (v_root, v_bob, '🎉');
end $$;
