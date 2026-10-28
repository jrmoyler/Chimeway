-- Chimeway: core schema.
--
-- Design notes carried over from the client rewrite:
--   * Messages are stored FLAT with a self-referencing parent_id. Thread
--     replies are ordinary messages, so editing, deleting, reacting and
--     searching work identically for replies and top-level messages.
--   * Reactions are rows, not a denormalised counter. A count is COUNT(*),
--     so it can never drift from the set of reactors, and the primary key
--     makes double-reacting impossible at the database level.
--   * Read state lives on channel_members.last_read_at, so unread counts are
--     derived rather than bookkept.

-- gen_random_uuid() is core PostgreSQL since v13, so no extension is needed.
-- Supabase ships PG15+, and avoiding the pgcrypto dependency keeps the schema
-- portable (and testable against a stock server).

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type channel_type as enum ('public', 'private', 'dm');
create type user_status  as enum ('active', 'idle', 'dnd', 'away', 'offline');
create type member_role  as enum ('owner', 'admin', 'member');

-- ---------------------------------------------------------------------------
-- Profiles: public-facing user data, 1:1 with auth.users
-- ---------------------------------------------------------------------------

create table public.profiles (
  id           uuid        primary key references auth.users (id) on delete cascade,
  full_name    text        not null default '',
  display_name text        not null,
  title        text        not null default '',
  avatar_url   text,
  status       user_status not null default 'active',
  last_seen_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint profiles_display_name_format
    check (display_name ~ '^[a-z0-9._-]{2,32}$'),
  constraint profiles_full_name_len  check (char_length(full_name) <= 80),
  constraint profiles_title_len      check (char_length(title) <= 120),
  constraint profiles_avatar_url_len check (avatar_url is null or char_length(avatar_url) <= 2048)
);

-- Handles are used for @mentions, so they must be unique and case-insensitive.
create unique index profiles_display_name_key on public.profiles (lower(display_name));

-- ---------------------------------------------------------------------------
-- Workspaces
-- ---------------------------------------------------------------------------

create table public.workspaces (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null,
  initials   text        not null,
  color      text        not null default '#1264a3',
  created_by uuid        not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),

  constraint workspaces_name_len     check (char_length(name) between 1 and 80),
  constraint workspaces_initials_len check (char_length(initials) between 1 and 2),
  constraint workspaces_color_format check (color ~ '^#[0-9a-fA-F]{6}$')
);

create table public.workspace_members (
  workspace_id uuid        not null references public.workspaces (id) on delete cascade,
  user_id      uuid        not null references public.profiles (id)   on delete cascade,
  role         member_role not null default 'member',
  joined_at    timestamptz not null default now(),

  primary key (workspace_id, user_id)
);

create index workspace_members_user_idx on public.workspace_members (user_id);

-- ---------------------------------------------------------------------------
-- Channels
-- ---------------------------------------------------------------------------

create table public.channels (
  id           uuid         primary key default gen_random_uuid(),
  workspace_id uuid         not null references public.workspaces (id) on delete cascade,
  type         channel_type not null,
  -- DM labels are derived from members at render time, so name stays empty
  -- for DMs rather than freezing a list of names that goes stale on rename.
  name         text         not null default '',
  description  text         not null default '',
  created_by   uuid         not null references public.profiles (id) on delete restrict,
  created_at   timestamptz  not null default now(),

  constraint channels_description_len check (char_length(description) <= 500),
  constraint channels_name_shape check (
    case
      when type = 'dm' then name = ''
      else name ~ '^[a-z0-9][a-z0-9_-]{0,78}[a-z0-9]$' or name ~ '^[a-z0-9]$'
    end
  )
);

-- Channel names are unique per workspace; DMs are exempt (they have no name).
create unique index channels_workspace_name_key
  on public.channels (workspace_id, name)
  where type <> 'dm';

create index channels_workspace_idx on public.channels (workspace_id);

create table public.channel_members (
  channel_id   uuid        not null references public.channels (id) on delete cascade,
  user_id      uuid        not null references public.profiles (id) on delete cascade,
  joined_at    timestamptz not null default now(),
  -- Unread counts are derived from this rather than tracked as flags.
  last_read_at timestamptz not null default now(),

  primary key (channel_id, user_id)
);

create index channel_members_user_idx on public.channel_members (user_id);

-- ---------------------------------------------------------------------------
-- Messages
-- ---------------------------------------------------------------------------

create table public.messages (
  id         uuid        primary key default gen_random_uuid(),
  channel_id uuid        not null references public.channels (id) on delete cascade,
  -- NULL for a top-level message; the root message id for a thread reply.
  parent_id  uuid        references public.messages (id) on delete cascade,
  user_id    uuid        not null references public.profiles (id) on delete cascade,
  body       text        not null default '',
  created_at timestamptz not null default now(),
  edited_at  timestamptz,

  constraint messages_body_len check (char_length(body) <= 4000),
  constraint messages_not_self_parent check (parent_id is null or parent_id <> id)
);

-- The dominant read pattern: a channel's top-level messages, newest last.
create index messages_channel_created_idx
  on public.messages (channel_id, created_at desc)
  where parent_id is null;

create index messages_parent_idx on public.messages (parent_id) where parent_id is not null;
create index messages_user_idx on public.messages (user_id);

-- Full-text search over message bodies.
create index messages_body_fts_idx
  on public.messages using gin (to_tsvector('english', body));

-- ---------------------------------------------------------------------------
-- Reactions
-- ---------------------------------------------------------------------------

create table public.message_reactions (
  message_id uuid        not null references public.messages (id) on delete cascade,
  user_id    uuid        not null references public.profiles (id) on delete cascade,
  emoji      text        not null,
  created_at timestamptz not null default now(),

  -- One reaction per user per emoji per message, enforced by the key itself.
  primary key (message_id, user_id, emoji),

  constraint message_reactions_emoji_len check (char_length(emoji) between 1 and 16)
);

create index message_reactions_message_idx on public.message_reactions (message_id);

-- ---------------------------------------------------------------------------
-- Attachments
-- ---------------------------------------------------------------------------

create table public.attachments (
  id           uuid        primary key default gen_random_uuid(),
  message_id   uuid        not null references public.messages (id) on delete cascade,
  storage_path text        not null unique,
  name         text        not null,
  mime_type    text        not null,
  size_bytes   bigint      not null,
  created_at   timestamptz not null default now(),

  constraint attachments_name_len check (char_length(name) between 1 and 255),
  constraint attachments_size_positive check (size_bytes > 0),
  -- Mirrors the 5 MB client-side limit so a crafted request cannot exceed it.
  constraint attachments_size_limit check (size_bytes <= 5 * 1024 * 1024)
);

create index attachments_message_idx on public.attachments (message_id);
