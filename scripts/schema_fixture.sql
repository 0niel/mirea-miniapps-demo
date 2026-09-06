create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema extensions;
create extension pgcrypto with schema extensions;
create schema auth;
create schema core;
grant usage on schema auth, core, extensions to service_role;
create table auth.users (
  id uuid primary key,
  aud text,
  role text
);
create table core.organizations (id text primary key);
insert into core.organizations values ('mirea');
create table core.mini_app_moderators (
  organization_id text not null references core.organizations(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (organization_id, user_id)
);
grant select on core.mini_app_moderators to service_role;
create table core.mini_apps (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references core.organizations(id),
  owner_id uuid references auth.users(id),
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{2,39}$'),
  name text not null,
  description text not null,
  icon_emoji text,
  accent_color text check (accent_color ~ '^#[0-9a-fA-F]{6}$'),
  category text check (category in ('study','campus','tools','fun','social','other')),
  tags text[],
  requested_permissions text[] check (requested_permissions <@ array['identity','email','profile','group','notifications','location','camera','files','calendar']),
  source_kind text check (source_kind in ('service','hosted','remote')),
  status text check (status in ('draft','pending_review','published','rejected','suspended')),
  published_at timestamptz,
  updated_at timestamptz default now(),
  unique (organization_id, slug)
);
