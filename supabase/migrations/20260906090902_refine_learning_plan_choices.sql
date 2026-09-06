begin;

create or replace function public.miniapp_learning_roadmap(p_user_id uuid, p_action text, p_params jsonb default '{}'::jsonb)
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
  v_selected jsonb;
  v_targets jsonb;
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
  if p_action not in ('home', 'catalog', 'plan', 'compare', 'select_plan', 'save_filters', 'save_goal', 'save_note', 'set_chosen') then
    raise exception 'Unknown action' using errcode = '22023';
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

  if p_action in ('save_note', 'set_chosen') then
    v_discipline_id := v_params ->> 'discipline_id';
    select d into v_selected from jsonb_array_elements(v_plan -> 'disciplines') d where d ->> 'id' = v_discipline_id;
    if v_selected is null then
      raise exception 'Discipline not found' using errcode = 'P0002';
    end if;
    if p_action = 'set_chosen' then
      if jsonb_typeof(v_params -> 'chosen') is distinct from 'boolean'
        or coalesce(v_params ->> 'scope', 'semester') not in ('semester', 'subject')
        or not (coalesce(v_selected ->> 'choice_group', '') <> '' or coalesce(v_selected -> 'is_optional' = 'true'::jsonb, false) or coalesce(v_selected ->> 'kind', '') = 'elective') then
        raise exception 'Invalid discipline choice' using errcode = '22023';
      end if;
      select jsonb_agg(d) into v_targets from jsonb_array_elements(v_plan -> 'disciplines') d
      where d ->> 'id' = v_discipline_id or (
        v_params ->> 'scope' = 'subject'
        and coalesce(v_selected ->> 'subject_id', '') <> ''
        and d ->> 'subject_id' = v_selected ->> 'subject_id'
        and coalesce(d ->> 'choice_group', '') = coalesce(v_selected ->> 'choice_group', '')
        and (coalesce(d ->> 'choice_group', '') <> '' or coalesce(d -> 'is_optional' = 'true'::jsonb, false) or coalesce(d ->> 'kind', '') = 'elective')
      );
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text || v_plan_id, 0));
      if (v_params ->> 'chosen')::boolean then
        update miniapp_learning_roadmap.progress p set chosen = false, updated_at = now()
        where p.user_id = p_user_id and p.plan_id = v_plan_id
          and p.discipline_id in (
            select d ->> 'id' from jsonb_array_elements(v_plan -> 'disciplines') d
            join jsonb_array_elements(v_targets) selected
              on coalesce(selected ->> 'choice_group', '') <> ''
              and d ->> 'choice_group' = selected ->> 'choice_group'
              and d -> 'semester' is not distinct from selected -> 'semester'
          );
      end if;
      insert into miniapp_learning_roadmap.progress (user_id, plan_id, discipline_id, chosen)
      select p_user_id, v_plan_id, d ->> 'id', (v_params ->> 'chosen')::boolean
      from jsonb_array_elements(v_targets) d
      on conflict (user_id, plan_id, discipline_id) do update set chosen = excluded.chosen, updated_at = now();
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
    select coalesce(jsonb_agg(jsonb_build_object('discipline_id', p.discipline_id, 'chosen', p.chosen, 'note', p.note, 'updated_at', p.updated_at)), '[]'::jsonb) into v_records
    from miniapp_learning_roadmap.progress p where user_id = p_user_id and plan_id = v_plan_id;
    return jsonb_build_object('plan', v_plan, 'records', v_records, 'preferences', v_prefs);
  end if;
  raise exception 'Unknown action' using errcode = '22023';
end;
$$;
revoke all on function public.miniapp_learning_roadmap(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.miniapp_learning_roadmap(uuid, text, jsonb) to service_role;

update core.mini_apps set description = 'Учебные планы РТУ МИРЭА: семестры, нагрузка, дисциплины по выбору, сравнение программ, заметки и напоминания.', updated_at = now()
where organization_id = 'mirea' and slug = 'learning-roadmap';


commit;
