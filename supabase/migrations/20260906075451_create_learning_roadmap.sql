begin;

create schema if not exists miniapp_learning_roadmap;
revoke all on schema miniapp_learning_roadmap from public, anon, authenticated;
grant usage on schema miniapp_learning_roadmap to service_role;

create table miniapp_learning_roadmap.plans (
  id text primary key check (id ~ '^[a-zA-Z0-9_.:-]{1,160}$'),
  title text not null check (char_length(title) between 1 and 1000),
  program_code text not null default '',
  profile text not null default '',
  level text not null default '',
  study_form text not null default '',
  admission_year integer check (admission_year between 1990 and 2100),
  institute text not null default '',
  quality text not null check (quality in ('complete', 'partial', 'unavailable')),
  source_url text not null check (source_url ~ '^https://([a-zA-Z0-9-]+\.)*mirea\.ru/'),
  document jsonb not null check (jsonb_typeof(document) = 'object' and octet_length(document::text) <= 1048576),
  imported_at timestamptz not null default now()
);
create index learning_roadmap_plan_filters on miniapp_learning_roadmap.plans (admission_year desc, program_code, id);

create table miniapp_learning_roadmap.preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan_id text references miniapp_learning_roadmap.plans(id) on delete set null,
  goal text not null default '' check (char_length(goal) <= 500),
  filters jsonb not null default '{}'::jsonb check (jsonb_typeof(filters) = 'object' and octet_length(filters::text) <= 4096),
  updated_at timestamptz not null default now()
);
create table miniapp_learning_roadmap.progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id text not null references miniapp_learning_roadmap.plans(id) on delete cascade,
  discipline_id text not null check (discipline_id ~ '^[a-zA-Z0-9_.:-]{1,160}$'),
  completed boolean not null default false,
  chosen boolean not null default false,
  note text not null default '' check (char_length(note) <= 2000),
  updated_at timestamptz not null default now(),
  primary key (user_id, plan_id, discipline_id)
);
alter table miniapp_learning_roadmap.plans enable row level security;
alter table miniapp_learning_roadmap.preferences enable row level security;
alter table miniapp_learning_roadmap.progress enable row level security;
revoke all on all tables in schema miniapp_learning_roadmap from public, anon, authenticated;
grant select, insert, update, delete on all tables in schema miniapp_learning_roadmap to service_role;

create function public.learning_roadmap_import(p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_plan jsonb;
  v_doc jsonb;
  v_old miniapp_learning_roadmap.plans%rowtype;
  v_total integer := 0;
  v_preserved integer := 0;
begin
  if current_user not in ('service_role', 'postgres') then
    raise exception 'Service access required' using errcode = '42501';
  end if;
  if p_payload ->> 'schema_version' is distinct from '1'
    or jsonb_typeof(p_payload -> 'plans') is distinct from 'array'
    or jsonb_array_length(p_payload -> 'plans') not between 1 and 200 then
    raise exception 'Invalid curriculum batch' using errcode = '22023';
  end if;
  for v_plan in select value from jsonb_array_elements(p_payload -> 'plans') loop
    if jsonb_typeof(v_plan) is distinct from 'object'
      or coalesce(v_plan ->> 'id', '') !~ '^[a-zA-Z0-9_.:-]{1,160}$'
      or coalesce(v_plan ->> 'quality', '') not in ('complete', 'partial', 'unavailable')
      or jsonb_typeof(v_plan -> 'disciplines') is distinct from 'array'
      or jsonb_array_length(v_plan -> 'disciplines') > 2000
      or (v_plan ->> 'quality' = 'unavailable' and jsonb_array_length(v_plan -> 'disciplines') <> 0)
      or (v_plan ->> 'quality' <> 'unavailable' and jsonb_array_length(v_plan -> 'disciplines') = 0)
      or exists (select 1 from jsonb_array_elements(v_plan -> 'disciplines') d
        where coalesce(d ->> 'id', '') !~ '^[a-zA-Z0-9_.:-]{1,160}$'
          or char_length(coalesce(d ->> 'name', '')) not between 1 and 1000)
      or (select count(*) <> count(distinct d ->> 'id') from jsonb_array_elements(v_plan -> 'disciplines') d) then
      raise exception 'Invalid curriculum document' using errcode = '22023';
    end if;
    select * into v_old from miniapp_learning_roadmap.plans where id = v_plan ->> 'id';
    v_doc := v_plan;
    if found and ((v_old.quality = 'complete' and v_plan ->> 'quality' <> 'complete')
      or (v_old.quality = 'partial' and v_plan ->> 'quality' = 'unavailable')
      or (v_old.quality = 'partial' and v_plan ->> 'quality' = 'partial' and exists (
        select 1 from jsonb_array_elements(v_old.document -> 'disciplines') old_d
        where not exists (select 1 from jsonb_array_elements(v_plan -> 'disciplines') new_d where new_d ->> 'id' = old_d ->> 'id')
      ))) then
      v_doc := v_old.document || jsonb_build_object(
        'last_check_at', p_payload -> 'generated_at',
        'latest_source_url', v_plan -> 'source_url',
        'latest_source_hash', v_plan -> 'source_hash',
        'latest_quality', v_plan -> 'quality',
        'stale', true,
        'warnings', coalesce(v_plan -> 'warnings', '[]'::jsonb) || jsonb_build_array('Сохранена предыдущая версия: последний разбор не дал достаточно данных. Сверься с источником.')
      );
      v_preserved := v_preserved + 1;
    end if;
    insert into miniapp_learning_roadmap.plans (
      id, title, program_code, profile, level, study_form, admission_year, institute, quality, source_url, document
    ) values (
      v_doc ->> 'id', v_doc ->> 'title', coalesce(v_doc ->> 'program_code', ''),
      coalesce(v_doc ->> 'profile', ''), coalesce(v_doc ->> 'level', ''), coalesce(v_doc ->> 'study_form', ''),
      nullif(v_doc ->> 'admission_year', '')::integer, coalesce(v_doc ->> 'institute', ''),
      v_doc ->> 'quality', v_doc ->> 'source_url', v_doc
    ) on conflict (id) do update set
      title = excluded.title, program_code = excluded.program_code, profile = excluded.profile,
      level = excluded.level, study_form = excluded.study_form, admission_year = excluded.admission_year,
      institute = excluded.institute, quality = excluded.quality, source_url = excluded.source_url,
      document = excluded.document, imported_at = now();
    v_total := v_total + 1;
  end loop;
  return jsonb_build_object('imported', v_total, 'preserved', v_preserved);
end;
$$;
revoke all on function public.learning_roadmap_import(jsonb) from public, anon, authenticated;
grant execute on function public.learning_roadmap_import(jsonb) to service_role;

create function public.miniapp_learning_roadmap(p_user_id uuid, p_action text, p_params jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_params jsonb := coalesce(p_params, '{}'::jsonb);
  v_plan_id text;
  v_discipline_id text;
  v_plan jsonb;
  v_other jsonb;
  v_prefs jsonb;
  v_records jsonb;
  v_result jsonb;
  v_filters jsonb;
  v_page integer;
  v_query text;
  v_count integer;
begin
  if current_user not in ('service_role', 'postgres') or p_user_id is null then
    raise exception 'Authenticated user required' using errcode = '42501';
  end if;
  begin
    insert into miniapp_learning_roadmap.preferences(user_id) values (p_user_id)
    on conflict (user_id) do nothing;
  exception when foreign_key_violation then
    raise exception 'Authenticated user required' using errcode = '42501';
  end;
  if jsonb_typeof(v_params) <> 'object' or octet_length(v_params::text) > 8192 then
    raise exception 'Invalid parameters' using errcode = '22023';
  end if;
  select to_jsonb(p) - 'user_id' into v_prefs from miniapp_learning_roadmap.preferences p where user_id = p_user_id;
  v_prefs := coalesce(v_prefs, '{}'::jsonb);
  v_plan_id := coalesce(nullif(v_params ->> 'id', ''), v_prefs ->> 'plan_id');

  if p_action = 'catalog' then
    v_params := coalesce(v_prefs -> 'filters', '{}'::jsonb) || v_params;
    v_page := least(10000, greatest(0, coalesce((v_params ->> 'page')::integer, 0)));
    v_query := left(coalesce(v_params ->> 'q', ''), 100);
    with filtered as (
      select p.* from miniapp_learning_roadmap.plans p
      where (v_query = '' or position(lower(v_query) in lower(concat_ws(' ', p.title, p.program_code, p.profile, p.institute))) > 0)
        and (coalesce(v_params ->> 'year', '') = '' or p.admission_year::text = v_params ->> 'year')
        and (coalesce(v_params ->> 'level', '') = '' or p.level = v_params ->> 'level')
        and (coalesce(v_params ->> 'form', '') = '' or p.study_form = v_params ->> 'form')
        and (coalesce(v_params ->> 'institute', '') = '' or p.institute = v_params ->> 'institute')
        and (coalesce(v_params ->> 'code', '') = '' or p.program_code = v_params ->> 'code')
    ), page as (
      select document - 'disciplines' - 'semesters' as doc
      from filtered order by admission_year desc nulls last, program_code, title, id
      limit 12 offset v_page * 12
    ) select (select count(*) from filtered), coalesce(jsonb_agg(doc), '[]'::jsonb) into v_count, v_result from page;
    select jsonb_build_object(
      'years', (select coalesce(jsonb_agg(v), '[]'::jsonb) from (select distinct admission_year v from miniapp_learning_roadmap.plans where admission_year is not null order by v desc limit 100) q),
      'levels', (select coalesce(jsonb_agg(v), '[]'::jsonb) from (select distinct level v from miniapp_learning_roadmap.plans where level <> '' order by v limit 100) q),
      'forms', (select coalesce(jsonb_agg(v), '[]'::jsonb) from (select distinct study_form v from miniapp_learning_roadmap.plans where study_form <> '' order by v limit 100) q),
      'institutes', (select coalesce(jsonb_agg(v), '[]'::jsonb) from (select distinct institute v from miniapp_learning_roadmap.plans where institute <> '' order by v limit 100) q),
      'codes', (select coalesce(jsonb_agg(v), '[]'::jsonb) from (select distinct program_code v from miniapp_learning_roadmap.plans where program_code <> '' order by v limit 200) q)
    ) into v_filters;
    return jsonb_build_object('plans', v_result, 'total', v_count, 'page', v_page, 'filters', v_filters, 'applied', v_params, 'preferences', v_prefs);
  end if;

  if p_action = 'save_filters' then
    v_filters := jsonb_build_object('q', left(coalesce(v_params ->> 'q', ''), 100),
      'year', left(coalesce(v_params ->> 'year', ''), 4), 'level', left(coalesce(v_params ->> 'level', ''), 200),
      'form', left(coalesce(v_params ->> 'form', ''), 200), 'institute', left(coalesce(v_params ->> 'institute', ''), 500),
      'code', left(coalesce(v_params ->> 'code', ''), 40));
    insert into miniapp_learning_roadmap.preferences (user_id, filters) values (p_user_id, v_filters)
    on conflict (user_id) do update set filters = excluded.filters, updated_at = now();
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'save_goal' then
    if char_length(coalesce(v_params ->> 'goal', '')) > 500 then raise exception 'Goal too long' using errcode = '22023'; end if;
    insert into miniapp_learning_roadmap.preferences (user_id, goal) values (p_user_id, coalesce(v_params ->> 'goal', ''))
    on conflict (user_id) do update set goal = excluded.goal, updated_at = now();
    return jsonb_build_object('ok', true);
  end if;

  select document into v_plan from miniapp_learning_roadmap.plans where id = v_plan_id;
  if p_action = 'home' and v_plan is null then
    return jsonb_build_object('plan', null, 'preferences', v_prefs, 'catalog_count', (select count(*) from miniapp_learning_roadmap.plans));
  end if;
  if v_plan is null then raise exception 'Plan not found' using errcode = 'P0002'; end if;

  if p_action = 'select_plan' then
    insert into miniapp_learning_roadmap.preferences(user_id, plan_id) values (p_user_id, v_plan_id)
    on conflict (user_id) do update set plan_id = excluded.plan_id, updated_at = now();
    return jsonb_build_object('ok', true);
  end if;

  if p_action in ('set_completed', 'save_note', 'set_chosen') then
    v_discipline_id := v_params ->> 'discipline_id';
    if not exists (select 1 from jsonb_array_elements(v_plan -> 'disciplines') d where d ->> 'id' = v_discipline_id) then
      raise exception 'Discipline not found' using errcode = 'P0002';
    end if;
    if p_action = 'set_chosen' then
      if jsonb_typeof(v_params -> 'chosen') is distinct from 'boolean'
        or not exists (select 1 from jsonb_array_elements(v_plan -> 'disciplines') d where d ->> 'id' = v_discipline_id
          and (coalesce(d ->> 'choice_group', '') <> '' or d -> 'is_optional' = 'true'::jsonb)) then
        raise exception 'Invalid discipline choice' using errcode = '22023';
      end if;
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text || v_plan_id, 0));
      if (v_params ->> 'chosen')::boolean then
        update miniapp_learning_roadmap.progress p set chosen = false, updated_at = now()
        where p.user_id = p_user_id and p.plan_id = v_plan_id
          and p.discipline_id in (
            select d ->> 'id' from jsonb_array_elements(v_plan -> 'disciplines') d
            join jsonb_array_elements(v_plan -> 'disciplines') selected
              on selected ->> 'id' = v_discipline_id
              and coalesce(selected ->> 'choice_group', '') <> ''
              and d ->> 'choice_group' = selected ->> 'choice_group'
              and d -> 'semester' is not distinct from selected -> 'semester'
          );
      end if;
      insert into miniapp_learning_roadmap.progress (user_id, plan_id, discipline_id, chosen)
      values (p_user_id, v_plan_id, v_discipline_id, (v_params ->> 'chosen')::boolean)
      on conflict (user_id, plan_id, discipline_id) do update set chosen = excluded.chosen, updated_at = now();
    elsif p_action = 'set_completed' then
      if jsonb_typeof(v_params -> 'completed') is distinct from 'boolean' then raise exception 'Invalid completion' using errcode = '22023'; end if;
      insert into miniapp_learning_roadmap.progress (user_id, plan_id, discipline_id, completed)
      values (p_user_id, v_plan_id, v_discipline_id, (v_params ->> 'completed')::boolean)
      on conflict (user_id, plan_id, discipline_id) do update set completed = excluded.completed, updated_at = now();
    else
      if char_length(coalesce(v_params ->> 'note', '')) > 2000 then raise exception 'Note too long' using errcode = '22023'; end if;
      insert into miniapp_learning_roadmap.progress (user_id, plan_id, discipline_id, note)
      values (p_user_id, v_plan_id, v_discipline_id, coalesce(v_params ->> 'note', ''))
      on conflict (user_id, plan_id, discipline_id) do update set note = excluded.note, updated_at = now();
    end if;
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'compare' then
    select document into v_other from miniapp_learning_roadmap.plans where id = v_params ->> 'other';
    if v_other is null then raise exception 'Second plan not found' using errcode = 'P0002'; end if;
    return jsonb_build_object('plan', v_plan, 'other', v_other);
  end if;

  if p_action in ('home', 'plan') then
    select coalesce(jsonb_agg(to_jsonb(p) - 'user_id' - 'plan_id'), '[]'::jsonb) into v_records
    from miniapp_learning_roadmap.progress p where user_id = p_user_id and plan_id = v_plan_id;
    return jsonb_build_object('plan', v_plan, 'progress', v_records, 'preferences', v_prefs);
  end if;
  raise exception 'Unknown action' using errcode = '22023';
end;
$$;
revoke all on function public.miniapp_learning_roadmap(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.miniapp_learning_roadmap(uuid, text, jsonb) to service_role;

insert into core.mini_apps (
  organization_id, owner_id, slug, name, description, icon_emoji, accent_color,
  category, tags, requested_permissions, source_kind, status, published_at
)
select 'mirea', null, 'learning-roadmap', 'Траектория',
  'Учебные планы РТУ МИРЭА по семестрам: выбор программы, сравнение, личный прогресс, заметки и напоминания.',
  '🧭', '#5369E8', 'study', array['учебный план', 'траектория', 'семестры', 'обучение'],
  array['calendar'], 'service', 'published', now()
where exists (select 1 from core.organizations where id = 'mirea')
on conflict (organization_id, slug) do update set
  name = excluded.name, description = excluded.description, icon_emoji = excluded.icon_emoji,
  accent_color = excluded.accent_color, category = excluded.category, tags = excluded.tags,
  requested_permissions = excluded.requested_permissions, source_kind = excluded.source_kind,
  status = excluded.status, published_at = coalesce(core.mini_apps.published_at, now()), updated_at = now();

commit;
