begin;

do $$
declare
  a uuid := extensions.gen_random_uuid();
  b uuid := extensions.gen_random_uuid();
  p text := 'test-roadmap-' || replace(extensions.gen_random_uuid()::text, '-', '');
  document jsonb;
  result jsonb;
  failed boolean;
begin
  assert not has_schema_privilege('anon', 'miniapp_learning_roadmap', 'usage');
  assert not has_schema_privilege('authenticated', 'miniapp_learning_roadmap', 'usage');
  assert not has_function_privilege('anon', 'public.miniapp_learning_roadmap(uuid,text,jsonb)', 'execute');
  assert not has_function_privilege('authenticated', 'public.miniapp_learning_roadmap(uuid,text,jsonb)', 'execute');
  assert not has_function_privilege('authenticated', 'public.learning_roadmap_import(jsonb)', 'execute');
  assert (select bool_and(relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'miniapp_learning_roadmap' and c.relkind = 'r');
  assert (select not bool_or(prosecdef) from pg_proc where oid in ('public.miniapp_learning_roadmap(uuid,text,jsonb)'::regprocedure, 'public.learning_roadmap_import(jsonb)'::regprocedure));
  insert into auth.users(id, aud, role) values (a, 'authenticated', 'authenticated'), (b, 'authenticated', 'authenticated');
  execute 'set local role service_role';
  assert current_user = 'service_role';
  document := jsonb_build_object('id', p, 'title', 'Проверка учебного плана', 'program_code', '09.03.04', 'admission_year', 2026,
    'quality', 'complete', 'source_url', 'https://www.mirea.ru/test.pdf', 'source_hash', 'first',
    'disciplines', jsonb_build_array(
      jsonb_build_object('id', 'math', 'name', 'Математика', 'semester', 1, 'hours', 144, 'credits', 4),
      jsonb_build_object('id', 'choice-a', 'subject_id', 'subject-a', 'name', 'Выбор А', 'semester', 1, 'choice_group', 'one', 'hours', 72, 'credits', 2),
      jsonb_build_object('id', 'choice-b', 'subject_id', 'subject-b', 'name', 'Выбор Б', 'semester', 1, 'choice_group', 'one', 'hours', 72, 'credits', 2),
      jsonb_build_object('id', 'choice-a-2', 'subject_id', 'subject-a', 'name', 'Выбор А', 'semester', 2, 'choice_group', 'one', 'hours', 72, 'credits', 2),
      jsonb_build_object('id', 'choice-b-2', 'subject_id', 'subject-b', 'name', 'Выбор Б', 'semester', 2, 'choice_group', 'one', 'hours', 108, 'credits', 3),
      jsonb_build_object('id', 'optional', 'name', 'Факультатив', 'semester', 2, 'kind', 'elective', 'hours', 36, 'credits', 1)));
  perform public.learning_roadmap_import(jsonb_build_object('schema_version', 1, 'plans', jsonb_build_array(document)));
  perform public.miniapp_learning_roadmap(a, 'select_plan', jsonb_build_object('id', p));
  insert into miniapp_learning_roadmap.progress(user_id, plan_id, discipline_id, completed) values (a, p, 'math', true);
  perform public.miniapp_learning_roadmap(a, 'save_note', jsonb_build_object('id', p, 'discipline_id', 'math', 'note', 'Только пользователь А'));
  perform public.miniapp_learning_roadmap(a, 'save_goal', jsonb_build_object('goal', 'Личная цель А'));
  result := public.miniapp_learning_roadmap(a, 'home');
  assert result -> 'preferences' ->> 'plan_id' = p;
  assert result -> 'preferences' ->> 'goal' = 'Личная цель А';
  assert result -> 'records' -> 0 ->> 'note' = 'Только пользователь А';
  assert not (result ? 'progress');
  assert not exists (select 1 from jsonb_array_elements(result -> 'records') r where r ? 'completed');
  result := public.miniapp_learning_roadmap(b, 'plan', jsonb_build_object('id', p));
  assert result -> 'records' = '[]'::jsonb;
  assert result -> 'preferences' ->> 'goal' = '';
  perform public.miniapp_learning_roadmap(a, 'set_chosen', jsonb_build_object('id', p, 'discipline_id', 'choice-a', 'chosen', true));
  perform public.miniapp_learning_roadmap(a, 'save_note', jsonb_build_object('id', p, 'discipline_id', 'choice-a', 'note', 'Заметка остаётся после замены'));
  perform public.miniapp_learning_roadmap(a, 'set_chosen', jsonb_build_object('id', p, 'discipline_id', 'choice-b', 'chosen', true));
  assert (select count(*) = 1 from miniapp_learning_roadmap.progress where user_id = a and plan_id = p and chosen);
  assert (select chosen from miniapp_learning_roadmap.progress where user_id = a and plan_id = p and discipline_id = 'choice-b');
  assert (select note = 'Заметка остаётся после замены' and not chosen from miniapp_learning_roadmap.progress where user_id = a and plan_id = p and discipline_id = 'choice-a');
  perform public.miniapp_learning_roadmap(a, 'set_chosen', jsonb_build_object('id', p, 'discipline_id', 'choice-b-2', 'chosen', true));
  assert (select count(*) = 2 from miniapp_learning_roadmap.progress where user_id = a and plan_id = p and chosen);
  perform public.miniapp_learning_roadmap(a, 'set_chosen', jsonb_build_object('id', p, 'discipline_id', 'choice-a', 'chosen', true, 'scope', 'subject'));
  assert (select count(*) = 2 and bool_and(discipline_id in ('choice-a', 'choice-a-2')) from miniapp_learning_roadmap.progress where user_id = a and plan_id = p and chosen);
  perform public.miniapp_learning_roadmap(a, 'set_chosen', jsonb_build_object('id', p, 'discipline_id', 'choice-a', 'chosen', false, 'scope', 'semester'));
  assert (select count(*) = 1 and bool_and(discipline_id = 'choice-a-2') from miniapp_learning_roadmap.progress where user_id = a and plan_id = p and chosen);
  perform public.miniapp_learning_roadmap(a, 'set_chosen', jsonb_build_object('id', p, 'discipline_id', 'choice-a', 'chosen', false, 'scope', 'subject'));
  assert not exists (select 1 from miniapp_learning_roadmap.progress where user_id = a and plan_id = p and chosen);
  perform public.miniapp_learning_roadmap(a, 'set_chosen', jsonb_build_object('id', p, 'discipline_id', 'optional', 'chosen', true));
  assert (select chosen from miniapp_learning_roadmap.progress where user_id = a and plan_id = p and discipline_id = 'optional');
  assert (select completed from miniapp_learning_roadmap.progress where user_id = a and plan_id = p and discipline_id = 'math');
  result := public.miniapp_learning_roadmap(a, 'home');
  assert not exists (select 1 from jsonb_array_elements(result -> 'records') r where r ? 'completed');
  failed := false;
  begin
    perform public.miniapp_learning_roadmap(a, 'set_chosen', jsonb_build_object('id', p, 'discipline_id', 'math', 'chosen', true));
  exception when invalid_parameter_value then failed := true;
  end;
  assert failed;
  failed := false;
  begin
    perform public.miniapp_learning_roadmap(a, 'set_completed', jsonb_build_object('id', p, 'discipline_id', 'math', 'completed', false));
  exception when invalid_parameter_value then failed := true;
  end;
  assert failed;
  failed := false;
  begin
    perform public.miniapp_learning_roadmap(a, 'save_note', jsonb_build_object('id', p, 'discipline_id', 'not-present', 'note', ''));
  exception when no_data_found then failed := true;
  end;
  assert failed;
  failed := false;
  begin
    perform public.miniapp_learning_roadmap(extensions.gen_random_uuid(), 'home');
  exception when insufficient_privilege then failed := true;
  end;
  assert failed;
  failed := false;
  begin
    perform public.miniapp_learning_roadmap(a, 'save_note', jsonb_build_object('id', p, 'discipline_id', 'math', 'note', repeat('x', 2001)));
  exception when invalid_parameter_value then failed := true;
  end;
  assert failed;
  perform public.learning_roadmap_import(jsonb_build_object('schema_version', 1, 'generated_at', now(), 'plans', jsonb_build_array(document || jsonb_build_object('quality', 'unavailable', 'disciplines', '[]'::jsonb, 'source_hash', 'failed'))));
  select plan.document into result from miniapp_learning_roadmap.plans plan where id = p;
  assert result ->> 'source_hash' = 'first';
  assert result ->> 'latest_source_hash' = 'failed';
  assert result -> 'stale' = 'true'::jsonb;
  assert jsonb_array_length(result -> 'disciplines') = 6;
  perform public.learning_roadmap_import(jsonb_build_object('schema_version', 1, 'plans', jsonb_build_array(document || jsonb_build_object('source_hash', 'fresh'))));
  select plan.document into result from miniapp_learning_roadmap.plans plan where id = p;
  assert result ->> 'source_hash' = 'fresh';
  assert not (result ? 'stale');
  document := document || jsonb_build_object('id', p || '-partial', 'quality', 'partial');
  perform public.learning_roadmap_import(jsonb_build_object('schema_version', 1, 'plans', jsonb_build_array(document)));
  perform public.learning_roadmap_import(jsonb_build_object('schema_version', 1, 'plans', jsonb_build_array(document || jsonb_build_object('disciplines', jsonb_build_array(document -> 'disciplines' -> 0)))));
  select plan.document into result from miniapp_learning_roadmap.plans plan where id = p || '-partial';
  assert jsonb_array_length(result -> 'disciplines') = 6;
  assert result -> 'stale' = 'true'::jsonb;
end;
$$;

select 'learning roadmap access, isolation, validation, elective and import tests passed' as result;
rollback;
