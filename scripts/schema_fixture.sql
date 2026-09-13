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
create table core.term (
  id integer primary key,
  organization_id text not null references core.organizations(id),
  starts_on date not null,
  ends_on date not null
);
create table core.schedule_teachers (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references core.organizations(id),
  full_name text not null check (length(trim(full_name)) > 0)
);
create table core.schedule_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references core.organizations(id),
  name text not null
);
create table core.schedule_disciplines (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references core.organizations(id),
  name text not null
);
create table core.schedule_item (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references core.organizations(id),
  term_id integer not null references core.term(id),
  kind text not null,
  title text not null,
  discipline_id uuid references core.schedule_disciplines(id),
  start_time time,
  end_time time,
  dates date[] not null check (cardinality(dates) > 0)
);
create table core.schedule_item_teacher (
  item_id uuid not null references core.schedule_item(id) on delete cascade,
  teacher_id uuid not null references core.schedule_teachers(id),
  primary key (item_id, teacher_id)
);
create table core.schedule_item_group (
  item_id uuid not null references core.schedule_item(id) on delete cascade,
  group_id uuid not null references core.schedule_groups(id),
  primary key (item_id, group_id)
);
create table core.user_academic_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  organization_id text references core.organizations(id),
  handle text,
  academic_group text,
  full_name text
);
create table core.teacher_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references core.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  teacher_name text not null check (length(trim(teacher_name)) > 0),
  clarity smallint not null check (clarity between 1 and 5),
  loyalty smallint not null check (loyalty between 1 and 5),
  usefulness smallint not null check (usefulness between 1 and 5),
  body text not null default '',
  is_anonymous boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, teacher_name)
);
grant select on core.term, core.schedule_teachers, core.schedule_groups, core.schedule_disciplines, core.schedule_item, core.schedule_item_teacher, core.schedule_item_group, core.user_academic_profiles to service_role;
grant select, insert, update, delete on core.teacher_reviews to service_role;
