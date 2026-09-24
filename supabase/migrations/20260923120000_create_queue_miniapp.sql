begin;

create schema if not exists miniapp_queue;
revoke all on schema miniapp_queue from public, anon, authenticated;
grant usage on schema miniapp_queue to service_role;

create table miniapp_queue.queues (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[2-9A-HJ-NP-Z]{6}$'),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 2 and 80),
  note text not null default '' check (char_length(note) <= 280),
  mode text not null default 'join' check (mode in ('join', 'owner')),
  status text not null default 'open' check (status in ('open', 'closed', 'finished')),
  group_name text check (group_name is null or char_length(group_name) between 1 and 60),
  opens_at timestamptz,
  capacity integer check (capacity is null or capacity between 2 and 200),
  round_started_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create index queue_queues_owner on miniapp_queue.queues(owner_id, status, updated_at desc);
create index queue_queues_group on miniapp_queue.queues(group_name, created_at desc) where status <> 'finished' and group_name is not null;
create index queue_queues_stale on miniapp_queue.queues(updated_at) where status <> 'finished';

create table miniapp_queue.entries (
  id uuid primary key default gen_random_uuid(),
  queue_id uuid not null references miniapp_queue.queues(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  state text not null default 'waiting' check (state in ('waiting', 'current', 'done', 'left', 'removed')),
  pos integer check (pos is null or pos > 0),
  note text not null default '' check (char_length(note) <= 60),
  joined_at timestamptz not null default clock_timestamp(),
  called_at timestamptz,
  ended_at timestamptz,
  moved_by_owner boolean not null default false,
  constraint queue_entries_waiting_pos check ((state = 'waiting') = (pos is not null))
);
create unique index queue_entries_active on miniapp_queue.entries(queue_id, user_id) where state in ('waiting', 'current');
create index queue_entries_queue on miniapp_queue.entries(queue_id, state, pos);
create index queue_entries_user on miniapp_queue.entries(user_id, state);

create table miniapp_queue.events (
  id bigint generated always as identity primary key,
  queue_id uuid not null references miniapp_queue.queues(id) on delete cascade,
  kind text not null check (kind in ('created', 'joined', 'left', 'let_ahead', 'called', 'done', 'skipped', 'removed', 'moved', 'shuffled', 'opened', 'closed', 'finished', 'reopened', 'reset', 'edited', 'mode')),
  actor_id uuid references auth.users(id) on delete set null,
  target_id uuid references auth.users(id) on delete set null,
  from_pos integer,
  to_pos integer,
  created_at timestamptz not null default clock_timestamp()
);
create index queue_events_queue on miniapp_queue.events(queue_id, id desc);

create table miniapp_queue.visits (
  user_id uuid not null references auth.users(id) on delete cascade,
  queue_id uuid not null references miniapp_queue.queues(id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (user_id, queue_id)
);
create index queue_visits_user on miniapp_queue.visits(user_id, seen_at desc);
create index queue_visits_queue on miniapp_queue.visits(queue_id);

create table miniapp_queue.daily_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  action text not null check (action in ('create', 'join', 'manage', 'self')),
  uses integer not null check (uses > 0),
  primary key (user_id, usage_date, action)
);

alter table miniapp_queue.queues enable row level security;
alter table miniapp_queue.entries enable row level security;
alter table miniapp_queue.events enable row level security;
alter table miniapp_queue.visits enable row level security;
alter table miniapp_queue.daily_usage enable row level security;
revoke all on all tables in schema miniapp_queue from public, anon, authenticated;
grant select, insert, update, delete on all tables in schema miniapp_queue to service_role;

create function miniapp_queue.today()
returns date language sql stable security invoker set search_path = '' as $$
  select (now() at time zone 'Europe/Moscow')::date;
$$;

create function miniapp_queue.person_name(p_user uuid)
returns text language sql stable security invoker set search_path = '' as $$
  select case when p_user is null then null else coalesce(
    (select nullif(btrim(split_part(btrim(p.full_name), ' ', 1) || ' ' || split_part(btrim(p.full_name), ' ', 2)), '')
      from core.user_academic_profiles p where p.user_id = p_user),
    (select '@' || btrim(p.handle) from core.user_academic_profiles p where p.user_id = p_user and nullif(btrim(p.handle), '') is not null),
    'Студент #' || upper(left(md5(p_user::text), 4))
  ) end;
$$;

create function miniapp_queue.user_group(p_user uuid)
returns text language sql stable security invoker set search_path = '' as $$
  select nullif(btrim(p.academic_group), '') from core.user_academic_profiles p where p.user_id = p_user;
$$;

create function miniapp_queue.me_json(p_user uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'name', miniapp_queue.person_name(p_user),
    'group', miniapp_queue.user_group(p_user),
    'has_group', miniapp_queue.user_group(p_user) is not null
  );
$$;

create function miniapp_queue.consume(p_user uuid, p_action text, p_limit integer)
returns void language plpgsql security invoker set search_path = '' as $$
declare used integer;
begin
  insert into miniapp_queue.daily_usage(user_id, usage_date, action, uses)
  values (p_user, miniapp_queue.today(), p_action, 1)
  on conflict (user_id, usage_date, action) do update set uses = miniapp_queue.daily_usage.uses + 1
  where miniapp_queue.daily_usage.uses < p_limit
  returning uses into used;
  if used is null then raise exception 'Daily limit reached' using errcode = 'P0001'; end if;
end;
$$;

create function miniapp_queue.new_code()
returns text language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_bytes bytea;
  v_code text;
begin
  for attempt in 1..20 loop
    v_bytes := extensions.gen_random_bytes(6);
    v_code := '';
    for i in 0..5 loop
      v_code := v_code || substr(v_alphabet, 1 + get_byte(v_bytes, i) % 32, 1);
    end loop;
    if not exists (select 1 from miniapp_queue.queues q where q.code = v_code) then
      return v_code;
    end if;
  end loop;
  raise exception 'Code space exhausted' using errcode = 'P0001';
end;
$$;

create function miniapp_queue.log(p_queue uuid, p_kind text, p_actor uuid, p_target uuid default null, p_from integer default null, p_to integer default null)
returns bigint language plpgsql volatile security invoker set search_path = '' as $$
declare v_id bigint;
begin
  insert into miniapp_queue.events(queue_id, kind, actor_id, target_id, from_pos, to_pos)
  values (p_queue, p_kind, p_actor, p_target, p_from, p_to)
  returning id into v_id;
  update miniapp_queue.queues set updated_at = now() where id = p_queue;
  return v_id;
end;
$$;

create function miniapp_queue.renumber(p_queue uuid)
returns void language sql volatile security invoker set search_path = '' as $$
  update miniapp_queue.entries e set pos = r.rn
  from (
    select x.id, row_number() over (order by x.pos, x.joined_at, x.id)::integer as rn
    from miniapp_queue.entries x where x.queue_id = p_queue and x.state = 'waiting'
  ) r
  where e.id = r.id and e.pos is distinct from r.rn;
$$;

create function miniapp_queue.notify(p_user uuid, p_title text, p_body text, p_code text, p_key text)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  perform internal.notify_app_event_once(
    p_user, p_title, p_body,
    '/services/apps/queue/run?page=%2Fq%3Fcode%3D' || p_code,
    'queue', 'miniapp-queue:' || p_key
  );
exception when others then
  return;
end;
$$;

create function miniapp_queue.avg_seconds(p_queue uuid)
returns integer language sql stable security invoker set search_path = '' as $$
  select case when count(*) >= 2 then round(avg(d.s))::integer end
  from (
    select extract(epoch from e.ended_at - e.called_at) as s
    from miniapp_queue.entries e
    where e.queue_id = p_queue and e.state = 'done' and e.called_at is not null and e.ended_at is not null
      and e.ended_at - e.called_at between interval '20 seconds' and interval '3 hours'
    order by e.ended_at desc limit 8
  ) d;
$$;

create function miniapp_queue.call_next(p_queue miniapp_queue.queues, p_actor uuid)
returns uuid language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_entry miniapp_queue.entries%rowtype;
  v_next miniapp_queue.entries%rowtype;
begin
  select * into v_entry from miniapp_queue.entries e
  where e.queue_id = p_queue.id and e.state = 'waiting' order by e.pos limit 1;
  if not found then return null; end if;
  update miniapp_queue.entries set state = 'current', pos = null, called_at = clock_timestamp() where id = v_entry.id;
  perform miniapp_queue.renumber(p_queue.id);
  perform miniapp_queue.log(p_queue.id, 'called', p_actor, v_entry.user_id, v_entry.pos, null);
  if p_actor is distinct from v_entry.user_id then
    perform miniapp_queue.notify(v_entry.user_id, 'Ваша очередь 🔔',
      p_queue.title || ': подходите, вас вызвали.', p_queue.code, 'called:' || v_entry.id);
  end if;
  select * into v_next from miniapp_queue.entries e
  where e.queue_id = p_queue.id and e.state = 'waiting' and e.pos = 1;
  if found then
    perform miniapp_queue.notify(v_next.user_id, 'Вы следующий ⏳',
      p_queue.title || ': перед вами один человек. Будьте рядом.', p_queue.code, 'next:' || v_next.id || ':' || v_entry.id);
  end if;
  return v_entry.id;
end;
$$;

create function miniapp_queue.entry_json(e miniapp_queue.entries, p_user uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'id', e.id,
    'name', miniapp_queue.person_name(e.user_id),
    'group', miniapp_queue.user_group(e.user_id),
    'note', e.note,
    'state', e.state,
    'pos', e.pos,
    'joined_at', e.joined_at,
    'called_at', e.called_at,
    'ended_at', e.ended_at,
    'moved', e.moved_by_owner,
    'me', e.user_id = p_user
  );
$$;

create function miniapp_queue.card(p_q miniapp_queue.queues, p_user uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'code', p_q.code,
    'title', p_q.title,
    'note', p_q.note,
    'mode', p_q.mode,
    'status', p_q.status,
    'group_name', p_q.group_name,
    'opens_at', p_q.opens_at,
    'capacity', p_q.capacity,
    'owner_name', miniapp_queue.person_name(p_q.owner_id),
    'is_owner', p_q.owner_id = p_user,
    'waiting', (select count(*) from miniapp_queue.entries e where e.queue_id = p_q.id and e.state = 'waiting'),
    'done', (select count(*) from miniapp_queue.entries e where e.queue_id = p_q.id and e.state = 'done' and e.joined_at >= p_q.round_started_at),
    'current_name', (select miniapp_queue.person_name(e.user_id) from miniapp_queue.entries e
      where e.queue_id = p_q.id and e.state = 'current' order by e.called_at limit 1),
    'my_state', m.state,
    'my_pos', m.pos,
    'my_called_at', m.called_at,
    'avg_seconds', miniapp_queue.avg_seconds(p_q.id),
    'updated_at', p_q.updated_at,
    'finished_at', p_q.finished_at
  )
  from (select 1) x
  left join lateral (
    select e.state, e.pos, e.called_at from miniapp_queue.entries e
    where e.queue_id = p_q.id and e.user_id = p_user and e.state in ('waiting', 'current') limit 1
  ) m on true;
$$;

create function miniapp_queue.queue_state(p_queue uuid, p_user uuid, p_events integer)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select miniapp_queue.card(q, p_user) || jsonb_build_object(
    'created_at', q.created_at,
    'round_started_at', q.round_started_at,
    'counts', jsonb_build_object(
      'waiting', (select count(*) from miniapp_queue.entries e where e.queue_id = q.id and e.state = 'waiting'),
      'current', (select count(*) from miniapp_queue.entries e where e.queue_id = q.id and e.state = 'current'),
      'done', (select count(*) from miniapp_queue.entries e where e.queue_id = q.id and e.state = 'done' and e.joined_at >= q.round_started_at),
      'left', (select count(*) from miniapp_queue.entries e where e.queue_id = q.id and e.state in ('left', 'removed') and e.joined_at >= q.round_started_at)
    ),
    'shuffles', (select count(*) from miniapp_queue.events v where v.queue_id = q.id and v.kind = 'shuffled' and v.created_at >= q.round_started_at),
    'moves', (select count(*) from miniapp_queue.events v where v.queue_id = q.id and v.kind in ('moved', 'skipped', 'removed') and v.created_at >= q.round_started_at),
    'current', coalesce((select jsonb_agg(miniapp_queue.entry_json(e, p_user) order by e.called_at)
      from miniapp_queue.entries e where e.queue_id = q.id and e.state = 'current'), '[]'::jsonb),
    'waiting', coalesce((select jsonb_agg(miniapp_queue.entry_json(e, p_user) order by e.pos)
      from miniapp_queue.entries e where e.queue_id = q.id and e.state = 'waiting'), '[]'::jsonb),
    'done_list', coalesce((select jsonb_agg(miniapp_queue.entry_json(d, p_user) order by d.ended_at desc)
      from miniapp_queue.entries d where d.id in (
        select e.id from miniapp_queue.entries e where e.queue_id = q.id and e.state = 'done' and e.joined_at >= q.round_started_at
        order by e.ended_at desc limit 40)), '[]'::jsonb),
    'my', (select miniapp_queue.entry_json(e, p_user) from miniapp_queue.entries e
      where e.queue_id = q.id and e.user_id = p_user and e.state in ('waiting', 'current') limit 1),
    'events', coalesce((select jsonb_agg(jsonb_build_object(
        'id', v.id,
        'kind', v.kind,
        'actor', miniapp_queue.person_name(v.actor_id),
        'target', miniapp_queue.person_name(v.target_id),
        'actor_owner', v.actor_id is not null and v.actor_id = q.owner_id,
        'actor_me', v.actor_id is not null and v.actor_id = p_user,
        'target_me', v.target_id is not null and v.target_id = p_user,
        'self', v.actor_id is not null and v.actor_id = v.target_id,
        'from', v.from_pos,
        'to', v.to_pos,
        'at', v.created_at
      ) order by v.id desc)
      from (select * from miniapp_queue.events x where x.queue_id = q.id order by x.id desc limit greatest(1, least(p_events, 300))) v), '[]'::jsonb),
    'events_total', (select count(*) from miniapp_queue.events x where x.queue_id = q.id)
  )
  from miniapp_queue.queues q where q.id = p_queue;
$$;

create function miniapp_queue.subjects(p_group text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with term as (
    select t.id from core.term t
    where t.organization_id = 'mirea' and t.starts_on <= miniapp_queue.today()
    order by t.starts_on desc limit 1
  ), items as (
    select d.name, si.dates, si.start_time, si.lesson_type
    from core.schedule_groups g
    join core.schedule_item_group ig on ig.group_id = g.id
    join core.schedule_item si on si.id = ig.item_id
    join core.schedule_disciplines d on d.id = si.discipline_id
    where p_group is not null and g.organization_id = 'mirea' and g.name = p_group
      and si.term_id = (select id from term) and si.kind = 'lesson'
  ), grouped as (
    select i.name,
      bool_or(miniapp_queue.today() = any(i.dates)) as today,
      min(i.start_time) filter (where miniapp_queue.today() = any(i.dates)) as time,
      bool_or(i.lesson_type in ('laboratoryWork', 'practice')) as lab,
      count(*) as n
    from items i group by i.name
    order by bool_or(miniapp_queue.today() = any(i.dates)) desc,
      min(i.start_time) filter (where miniapp_queue.today() = any(i.dates)) nulls last,
      bool_or(i.lesson_type in ('laboratoryWork', 'practice')) desc, count(*) desc, i.name
    limit 12
  )
  select coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'today', s.today, 'time', s.time, 'lab', s.lab)
    order by s.today desc, s.time nulls last, s.lab desc, s.n desc, s.name), '[]'::jsonb)
  from grouped s;
$$;

create function miniapp_queue.home_state(p_user uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with g as (select miniapp_queue.user_group(p_user) as name),
  mine as (
    select q, e.state as st, e.pos as p, q.updated_at as u
    from miniapp_queue.entries e join miniapp_queue.queues q on q.id = e.queue_id
    where e.user_id = p_user and e.state in ('waiting', 'current') and q.status <> 'finished'
  ), owned as (
    select q from miniapp_queue.queues q
    where q.owner_id = p_user and q.status <> 'finished'
      and not exists (select 1 from mine m where (m.q).id = q.id)
    order by q.updated_at desc limit 15
  ), grp as (
    select q from miniapp_queue.queues q, g
    where g.name is not null and q.group_name = g.name and q.status <> 'finished' and q.owner_id <> p_user
      and not exists (select 1 from mine m where (m.q).id = q.id)
    order by q.created_at desc limit 10
  ), recent as (
    select q, v.seen_at from miniapp_queue.visits v join miniapp_queue.queues q on q.id = v.queue_id
    where v.user_id = p_user and q.status <> 'finished' and q.owner_id <> p_user
      and not exists (select 1 from mine m where (m.q).id = q.id)
      and not exists (select 1 from grp x where (x.q).id = q.id)
    order by v.seen_at desc limit 8
  ), archive as (
    select q from miniapp_queue.queues q
    where q.status = 'finished' and (q.owner_id = p_user
      or exists (select 1 from miniapp_queue.entries e where e.queue_id = q.id and e.user_id = p_user))
    order by coalesce(q.finished_at, q.updated_at) desc limit 10
  )
  select jsonb_build_object(
    'me', miniapp_queue.me_json(p_user),
    'mine', coalesce((select jsonb_agg(miniapp_queue.card(m.q, p_user) order by (m.st = 'current') desc, m.p nulls first, m.u desc) from mine m), '[]'::jsonb),
    'owned', coalesce((select jsonb_agg(miniapp_queue.card(o.q, p_user) order by (o.q).updated_at desc) from owned o), '[]'::jsonb),
    'group', coalesce((select jsonb_agg(miniapp_queue.card(x.q, p_user) order by (x.q).created_at desc) from grp x), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(miniapp_queue.card(r.q, p_user) order by r.seen_at desc) from recent r), '[]'::jsonb),
    'archive', coalesce((select jsonb_agg(miniapp_queue.card(a.q, p_user) order by coalesce((a.q).finished_at, (a.q).updated_at) desc) from archive a), '[]'::jsonb)
  );
$$;

create function miniapp_queue.text_ok(p_text text, p_max integer, p_multiline boolean default false)
returns boolean language sql immutable security invoker set search_path = '' as $$
  select p_text is not null and char_length(p_text) <= p_max and p_text !~ '\{\{|\}\}'
    and case when p_multiline then regexp_replace(p_text, '[

	]', '', 'g') else p_text end !~ '[[:cntrl:]]';
$$;

create function miniapp_queue.dispatch(p_user_id uuid, p_action text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare
  v jsonb := coalesce(p_payload, '{}'::jsonb);
  v_q miniapp_queue.queues%rowtype;
  v_e miniapp_queue.entries%rowtype;
  v_t miniapp_queue.entries%rowtype;
  v_group text;
  v_view text;
  v_title text;
  v_note text;
  v_mode text;
  v_status text;
  v_capacity integer;
  v_opens timestamptz;
  v_count integer;
  v_pos integer;
  v_to integer;
  v_event bigint;
  v_now timestamptz := clock_timestamp();
  v_manage constant text[] := array['next', 'skip', 'remove', 'move', 'shuffle', 'status', 'reset', 'edit', 'delete'];
begin
  if p_user_id is null then
    raise exception 'User unavailable' using errcode = '42501';
  end if;
  v_group := miniapp_queue.user_group(p_user_id);

  if p_action = 'state' then
    v_view := coalesce(v ->> 'view', 'home');
    if v_view = 'home' then
      return miniapp_queue.home_state(p_user_id);
    end if;
    if v_view = 'new' then
      return jsonb_build_object(
        'me', miniapp_queue.me_json(p_user_id),
        'subjects', miniapp_queue.subjects(v_group),
        'active_owned', (select count(*) from miniapp_queue.queues q where q.owner_id = p_user_id and q.status <> 'finished'),
        'recent_titles', coalesce((select jsonb_agg(t.title order by t.at desc) from (
          select q.title, max(q.created_at) as at from miniapp_queue.queues q
          where q.owner_id = p_user_id group by q.title order by max(q.created_at) desc limit 4) t), '[]'::jsonb)
      );
    end if;
    if v_view not in ('queue', 'history', 'edit') then
      raise exception 'Unknown view' using errcode = '22023';
    end if;
    select * into v_q from miniapp_queue.queues q where q.code = upper(coalesce(v ->> 'code', ''));
    if not found then
      return jsonb_build_object('me', miniapp_queue.me_json(p_user_id), 'queue', null);
    end if;
    begin
      insert into miniapp_queue.visits(user_id, queue_id) values (p_user_id, v_q.id)
      on conflict (user_id, queue_id) do update set seen_at = now()
      where miniapp_queue.visits.seen_at < now() - interval '5 minutes';
    exception when foreign_key_violation then
      raise exception 'User unavailable' using errcode = '42501';
    end;
    return jsonb_build_object(
      'me', miniapp_queue.me_json(p_user_id),
      'queue', miniapp_queue.queue_state(v_q.id, p_user_id, case when v_view = 'history' then 300 else 12 end)
    );
  end if;

  if p_action = 'resolve' then
    select * into v_q from miniapp_queue.queues q where q.code = upper(coalesce(v ->> 'code', ''));
    if not found then raise exception 'Queue missing' using errcode = 'P0002'; end if;
    return jsonb_build_object('ok', true, 'code', v_q.code, 'title', v_q.title);
  end if;

  if p_action = 'create' then
    v_title := btrim(coalesce(v ->> 'title', ''));
    v_note := btrim(coalesce(v ->> 'note', ''));
    v_mode := coalesce(v ->> 'mode', 'join');
    v_capacity := nullif((v ->> 'capacity')::integer, 0);
    v_opens := nullif(v ->> 'opens_at', '')::timestamptz;
    if char_length(v_title) not between 2 and 80 or not miniapp_queue.text_ok(v_title, 80)
      or not miniapp_queue.text_ok(v_note, 280, true) or v_mode not in ('join', 'owner')
      or (v_capacity is not null and v_capacity not between 2 and 200)
      or (v_opens is not null and v_opens > v_now + interval '60 days') then
      raise exception 'Invalid queue' using errcode = '22023';
    end if;
    if v_opens is not null and v_opens <= v_now then v_opens := null; end if;
    if (select count(*) from miniapp_queue.queues q where q.owner_id = p_user_id and q.status <> 'finished') >= 15 then
      return jsonb_build_object('ok', false, 'message', 'Можно вести до 15 активных очередей. Завершите одну из старых.');
    end if;
    begin
      perform miniapp_queue.consume(p_user_id, 'create', 20);
      insert into miniapp_queue.queues(code, owner_id, title, note, mode, group_name, opens_at, capacity)
      values (miniapp_queue.new_code(), p_user_id, v_title, v_note, v_mode,
        case when coalesce((v ->> 'group')::boolean, false) then v_group end, v_opens, v_capacity)
      returning * into v_q;
    exception when foreign_key_violation then
      raise exception 'User unavailable' using errcode = '42501';
    end;
    perform miniapp_queue.log(v_q.id, 'created', p_user_id);
    if coalesce((v ->> 'join_self')::boolean, false) and v_q.opens_at is null then
      insert into miniapp_queue.entries(queue_id, user_id, pos, joined_at) values (v_q.id, p_user_id, 1, clock_timestamp());
      perform miniapp_queue.log(v_q.id, 'joined', p_user_id, p_user_id, null, 1);
    end if;
    return jsonb_build_object('ok', true, 'code', v_q.code);
  end if;

  if p_action not in ('join', 'leave', 'let_ahead', 'start', 'done', 'note', 'next', 'skip', 'remove', 'move', 'shuffle', 'status', 'reset', 'edit', 'delete') then
    raise exception 'Action not found' using errcode = '22023';
  end if;

  select * into v_q from miniapp_queue.queues q where q.code = upper(coalesce(v ->> 'code', '')) for update;
  if not found then raise exception 'Queue missing' using errcode = 'P0002'; end if;

  if p_action = any(v_manage) then
    if v_q.owner_id <> p_user_id then raise exception 'Owner only' using errcode = '42501'; end if;
    perform miniapp_queue.consume(p_user_id, 'manage', 3000);
  elsif p_action <> 'join' then
    begin
      perform miniapp_queue.consume(p_user_id, 'self', 1000);
    exception when foreign_key_violation then
      raise exception 'User unavailable' using errcode = '42501';
    end;
  end if;

  if v_q.status = 'finished' and p_action in ('join', 'let_ahead', 'start', 'done', 'next', 'skip', 'remove', 'move', 'shuffle') then
    return jsonb_build_object('ok', false, 'message', 'Очередь завершена. Создатель может открыть её снова.');
  end if;

  if p_action in ('skip', 'remove', 'move') then
    select * into v_t from miniapp_queue.entries e
    where e.id = nullif(v ->> 'entry', '')::uuid and e.queue_id = v_q.id and e.state in ('waiting', 'current');
    if not found then raise exception 'Entry missing' using errcode = 'P0002'; end if;
  end if;

  if p_action = 'join' then
    if exists (select 1 from miniapp_queue.entries e where e.queue_id = v_q.id and e.user_id = p_user_id and e.state in ('waiting', 'current')) then
      return jsonb_build_object('ok', false, 'message', 'Вы уже в этой очереди');
    end if;
    if v_q.status = 'closed' then
      return jsonb_build_object('ok', false, 'message', 'Создатель закрыл запись в эту очередь');
    end if;
    if v_q.opens_at is not null and v_q.opens_at > v_now then
      return jsonb_build_object('ok', false, 'message', 'Запись ещё не открылась');
    end if;
    v_note := btrim(coalesce(v ->> 'note', ''));
    if not miniapp_queue.text_ok(v_note, 60) then raise exception 'Invalid note' using errcode = '22023'; end if;
    select count(*) into v_count from miniapp_queue.entries e where e.queue_id = v_q.id and e.state in ('waiting', 'current');
    if v_q.capacity is not null and v_count >= v_q.capacity then
      return jsonb_build_object('ok', false, 'message', 'Все места заняты');
    end if;
    if (select count(*) from miniapp_queue.entries e join miniapp_queue.queues x on x.id = e.queue_id
        where e.user_id = p_user_id and e.state in ('waiting', 'current') and x.status <> 'finished') >= 20 then
      return jsonb_build_object('ok', false, 'message', 'Можно стоять максимум в 20 очередях одновременно');
    end if;
    begin
      perform miniapp_queue.consume(p_user_id, 'join', 200);
    exception when foreign_key_violation then
      raise exception 'User unavailable' using errcode = '42501';
    end;
    v_pos := coalesce((select max(e.pos) from miniapp_queue.entries e where e.queue_id = v_q.id and e.state = 'waiting'), 0) + 1;
    insert into miniapp_queue.entries(queue_id, user_id, pos, note, joined_at)
    values (v_q.id, p_user_id, v_pos, v_note, clock_timestamp());
    perform miniapp_queue.log(v_q.id, 'joined', p_user_id, p_user_id, null, v_pos);
    return jsonb_build_object('ok', true, 'position', v_pos);
  end if;

  if p_action in ('leave', 'let_ahead', 'start', 'done', 'note') then
    select * into v_e from miniapp_queue.entries e
    where e.queue_id = v_q.id and e.user_id = p_user_id and e.state in ('waiting', 'current');
    if not found then
      return jsonb_build_object('ok', false, 'message', 'Вас нет в этой очереди');
    end if;
  end if;

  if p_action = 'note' then
    v_note := btrim(coalesce(v ->> 'note', ''));
    if not miniapp_queue.text_ok(v_note, 60) then raise exception 'Invalid note' using errcode = '22023'; end if;
    update miniapp_queue.entries set note = v_note where id = v_e.id;
    update miniapp_queue.queues set updated_at = now() where id = v_q.id;
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'leave' then
    update miniapp_queue.entries set state = 'left', pos = null, ended_at = clock_timestamp() where id = v_e.id;
    perform miniapp_queue.renumber(v_q.id);
    perform miniapp_queue.log(v_q.id, 'left', p_user_id, p_user_id, v_e.pos, null);
    if v_e.state = 'current' and v_q.status <> 'finished' then
      perform miniapp_queue.call_next(v_q, null);
    end if;
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'let_ahead' then
    if v_e.state <> 'waiting' then
      return jsonb_build_object('ok', false, 'message', 'Вас уже вызвали');
    end if;
    select * into v_t from miniapp_queue.entries e
    where e.queue_id = v_q.id and e.state = 'waiting' and e.pos = v_e.pos + 1;
    if not found then
      return jsonb_build_object('ok', false, 'message', 'За вами пока никого нет');
    end if;
    update miniapp_queue.entries set pos = case when id = v_e.id then v_t.pos else v_e.pos end
    where id in (v_e.id, v_t.id);
    v_event := miniapp_queue.log(v_q.id, 'let_ahead', p_user_id, v_t.user_id, v_e.pos, v_t.pos);
    perform miniapp_queue.notify(v_t.user_id, 'Вас пропустили вперёд 🙌',
      v_q.title || ': теперь вы ' || v_e.pos || '-й в очереди.', v_q.code, 'ahead:' || v_event);
    return jsonb_build_object('ok', true, 'position', v_t.pos);
  end if;

  if p_action = 'start' then
    if v_e.state = 'current' then
      return jsonb_build_object('ok', true);
    end if;
    if v_e.pos <> 1 then
      return jsonb_build_object('ok', false, 'message', 'Перед вами ещё есть люди');
    end if;
    if exists (select 1 from miniapp_queue.entries e where e.queue_id = v_q.id and e.state = 'current') then
      return jsonb_build_object('ok', false, 'message', 'Сейчас сдаёт другой участник. Дождитесь, пока он закончит.');
    end if;
    if v_q.opens_at is not null and v_q.opens_at > v_now then
      return jsonb_build_object('ok', false, 'message', 'Очередь ещё не началась');
    end if;
    perform miniapp_queue.call_next(v_q, p_user_id);
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'done' then
    if v_e.state <> 'current' then
      return jsonb_build_object('ok', false, 'message', 'Вас ещё не вызвали');
    end if;
    update miniapp_queue.entries set state = 'done', ended_at = clock_timestamp() where id = v_e.id;
    perform miniapp_queue.log(v_q.id, 'done', p_user_id, p_user_id);
    perform miniapp_queue.call_next(v_q, null);
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'next' then
    select count(*) into v_count from miniapp_queue.entries e where e.queue_id = v_q.id and e.state in ('waiting', 'current');
    if v_count = 0 then
      return jsonb_build_object('ok', false, 'message', 'В очереди никого нет');
    end if;
    for v_e in select * from miniapp_queue.entries e where e.queue_id = v_q.id and e.state = 'current' order by e.called_at loop
      update miniapp_queue.entries set state = 'done', ended_at = clock_timestamp() where id = v_e.id;
      perform miniapp_queue.log(v_q.id, 'done', p_user_id, v_e.user_id);
    end loop;
    perform miniapp_queue.call_next(v_q, p_user_id);
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'skip' then
    select count(*) into v_count from miniapp_queue.entries e where e.queue_id = v_q.id and e.state = 'waiting' and e.id <> v_t.id;
    v_to := v_count + 1;
    if v_t.state = 'waiting' and v_t.pos = v_to then
      return jsonb_build_object('ok', false, 'message', 'Участник и так последний');
    end if;
    update miniapp_queue.entries set state = 'waiting', pos = 2147483647, called_at = null, moved_by_owner = true where id = v_t.id;
    perform miniapp_queue.renumber(v_q.id);
    v_event := miniapp_queue.log(v_q.id, 'skipped', p_user_id, v_t.user_id, v_t.pos, v_to);
    perform miniapp_queue.notify(v_t.user_id, 'Вас перенесли в конец очереди',
      v_q.title || ': теперь вы ' || v_to || '-й. Подробности — в истории очереди.', v_q.code, 'skip:' || v_event);
    if v_t.state = 'current' and v_count > 0 then
      perform miniapp_queue.call_next(v_q, p_user_id);
    end if;
    return jsonb_build_object('ok', true, 'position', v_to);
  end if;

  if p_action = 'remove' then
    update miniapp_queue.entries set state = 'removed', pos = null, ended_at = clock_timestamp() where id = v_t.id;
    perform miniapp_queue.renumber(v_q.id);
    v_event := miniapp_queue.log(v_q.id, 'removed', p_user_id, v_t.user_id, v_t.pos, null);
    if v_t.user_id <> p_user_id then
      perform miniapp_queue.notify(v_t.user_id, 'Вас убрали из очереди',
        v_q.title || ': создатель убрал вас из списка. Запись есть в истории очереди.', v_q.code, 'remove:' || v_event);
    end if;
    if v_t.state = 'current' then
      perform miniapp_queue.call_next(v_q, p_user_id);
    end if;
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'move' then
    if v_q.mode <> 'owner' then
      return jsonb_build_object('ok', false, 'message', 'В этой очереди порядок определяется временем записи');
    end if;
    if v_t.state <> 'waiting' then
      return jsonb_build_object('ok', false, 'message', 'Участника уже вызвали');
    end if;
    select count(*) into v_count from miniapp_queue.entries e where e.queue_id = v_q.id and e.state = 'waiting';
    v_to := greatest(1, least(coalesce((v ->> 'to')::integer, v_t.pos), v_count));
    if v_to = v_t.pos then
      return jsonb_build_object('ok', true, 'position', v_to);
    end if;
    if v_to < v_t.pos then
      update miniapp_queue.entries set pos = pos + 1
      where queue_id = v_q.id and state = 'waiting' and pos >= v_to and pos < v_t.pos;
    else
      update miniapp_queue.entries set pos = pos - 1
      where queue_id = v_q.id and state = 'waiting' and pos > v_t.pos and pos <= v_to;
    end if;
    update miniapp_queue.entries set pos = v_to, moved_by_owner = true where id = v_t.id;
    v_event := miniapp_queue.log(v_q.id, 'moved', p_user_id, v_t.user_id, v_t.pos, v_to);
    if v_t.user_id <> p_user_id then
      perform miniapp_queue.notify(v_t.user_id, 'Ваше место изменилось',
        v_q.title || ': создатель переместил вас с ' || v_t.pos || '-го на ' || v_to || '-е место.', v_q.code, 'move:' || v_event);
    end if;
    return jsonb_build_object('ok', true, 'position', v_to);
  end if;

  if p_action = 'shuffle' then
    if v_q.mode <> 'owner' then
      return jsonb_build_object('ok', false, 'message', 'В этой очереди порядок определяется временем записи');
    end if;
    select count(*) into v_count from miniapp_queue.entries e where e.queue_id = v_q.id and e.state = 'waiting';
    if v_count < 2 then
      return jsonb_build_object('ok', false, 'message', 'Перемешивать пока некого');
    end if;
    update miniapp_queue.entries e set pos = r.rn, moved_by_owner = true
    from (
      select x.id, row_number() over (order by gen_random_uuid())::integer as rn
      from miniapp_queue.entries x where x.queue_id = v_q.id and x.state = 'waiting'
    ) r where e.id = r.id;
    v_event := miniapp_queue.log(v_q.id, 'shuffled', p_user_id, null, null, v_count);
    for v_e in select * from miniapp_queue.entries e where e.queue_id = v_q.id and e.state = 'waiting' and e.user_id <> p_user_id order by e.pos limit 60 loop
      perform miniapp_queue.notify(v_e.user_id, 'Порядок перемешан 🎲',
        v_q.title || ': по жребию вы ' || v_e.pos || '-й.', v_q.code, 'shuffle:' || v_event || ':' || v_e.id);
    end loop;
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'status' then
    v_status := v ->> 'status';
    if v_status is null or v_status not in ('open', 'closed', 'finished') then
      raise exception 'Invalid status' using errcode = '22023';
    end if;
    if v_status = v_q.status then
      return jsonb_build_object('ok', true);
    end if;
    update miniapp_queue.queues set status = v_status,
      finished_at = case when v_status = 'finished' then now() end
    where id = v_q.id;
    perform miniapp_queue.log(v_q.id,
      case when v_status = 'finished' then 'finished' when v_q.status = 'finished' then 'reopened' when v_status = 'open' then 'opened' else 'closed' end,
      p_user_id);
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'reset' then
    select count(*) into v_count from miniapp_queue.entries e where e.queue_id = v_q.id and e.state in ('waiting', 'current');
    update miniapp_queue.entries set state = 'removed', pos = null, ended_at = clock_timestamp()
    where queue_id = v_q.id and state in ('waiting', 'current');
    update miniapp_queue.queues set status = 'open', finished_at = null, round_started_at = clock_timestamp() where id = v_q.id;
    perform miniapp_queue.log(v_q.id, 'reset', p_user_id, null, v_count, null);
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'edit' then
    v_title := btrim(coalesce(v ->> 'title', v_q.title));
    v_note := btrim(coalesce(v ->> 'note', v_q.note));
    v_mode := coalesce(v ->> 'mode', v_q.mode);
    v_capacity := case when v ? 'capacity' then nullif((v ->> 'capacity')::integer, 0) else v_q.capacity end;
    v_opens := case when v ? 'opens_at' then nullif(v ->> 'opens_at', '')::timestamptz else v_q.opens_at end;
    if char_length(v_title) not between 2 and 80 or not miniapp_queue.text_ok(v_title, 80)
      or not miniapp_queue.text_ok(v_note, 280, true) or v_mode not in ('join', 'owner')
      or (v_capacity is not null and v_capacity not between 2 and 200)
      or (v_opens is not null and v_opens > v_now + interval '60 days') then
      raise exception 'Invalid queue' using errcode = '22023';
    end if;
    if v_opens is not null and v_opens <= v_now then v_opens := null; end if;
    update miniapp_queue.queues set title = v_title, note = v_note, mode = v_mode, capacity = v_capacity, opens_at = v_opens,
      group_name = case when v ? 'group' then case when (v ->> 'group')::boolean then coalesce(v_group, v_q.group_name) end else v_q.group_name end
    where id = v_q.id;
    if v_mode <> v_q.mode then
      perform miniapp_queue.log(v_q.id, 'mode', p_user_id, null, null, case when v_mode = 'owner' then 1 else 0 end);
    end if;
    if (v_title, v_note, v_capacity, v_opens) is distinct from (v_q.title, v_q.note, v_q.capacity, v_q.opens_at) then
      perform miniapp_queue.log(v_q.id, 'edited', p_user_id);
    end if;
    update miniapp_queue.queues set updated_at = now() where id = v_q.id;
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'delete' then
    if exists (select 1 from miniapp_queue.entries e where e.queue_id = v_q.id and e.state in ('waiting', 'current')) then
      return jsonb_build_object('ok', false, 'message', 'В очереди ещё есть участники. Сначала очистите её.');
    end if;
    delete from miniapp_queue.queues where id = v_q.id;
    return jsonb_build_object('ok', true);
  end if;

  raise exception 'Action not found' using errcode = '22023';
end;
$$;

create function miniapp_queue.cleanup()
returns void language plpgsql volatile security invoker set search_path = '' as $$
begin
  with stale as (
    update miniapp_queue.queues set status = 'finished', finished_at = now(), updated_at = now()
    where status <> 'finished' and updated_at < now() - interval '3 days'
      and (opens_at is null or opens_at < now() - interval '1 day')
    returning id
  )
  insert into miniapp_queue.events(queue_id, kind) select id, 'finished' from stale;
  delete from miniapp_queue.queues where status = 'finished' and coalesce(finished_at, updated_at) < now() - interval '120 days';
  delete from miniapp_queue.visits where seen_at < now() - interval '45 days';
  delete from miniapp_queue.daily_usage where usage_date < miniapp_queue.today() - 7;
end;
$$;

create function public.miniapp_queue_dispatch(p_user_id uuid, p_action text, p_payload jsonb default '{}'::jsonb)
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select miniapp_queue.dispatch(p_user_id, p_action, p_payload);
$$;

revoke all on all functions in schema miniapp_queue from public, anon, authenticated;
grant execute on all functions in schema miniapp_queue to service_role;
revoke all on function public.miniapp_queue_dispatch(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.miniapp_queue_dispatch(uuid, text, jsonb) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('queue-cleanup', '40 0 * * *', 'select miniapp_queue.cleanup()');
  end if;
end;
$$;

insert into core.mini_apps (organization_id, owner_id, slug, name, description, icon_emoji, accent_color, category, tags, requested_permissions, source_kind, status, published_at)
select 'mirea', null, 'queue', 'Очереди',
  'Живые очереди на сдачу лаб и зачётов: вход по коду или QR, честный порядок по времени записи или под управлением создателя, открытая история действий и уведомление, когда подходит ваша очередь.',
  '🎟️', '#0891B2', 'study', array['очередь', 'сдача', 'лабы', 'зачёт', 'qr', 'группа'], array['camera']::text[], 'service', 'published', now()
where exists (select 1 from core.organizations where id = 'mirea')
on conflict (organization_id, slug) do update set
  name = excluded.name, description = excluded.description, icon_emoji = excluded.icon_emoji,
  accent_color = excluded.accent_color, category = excluded.category, tags = excluded.tags,
  requested_permissions = excluded.requested_permissions, source_kind = excluded.source_kind,
  status = 'published', published_at = coalesce(core.mini_apps.published_at, now()), updated_at = now();

commit;
