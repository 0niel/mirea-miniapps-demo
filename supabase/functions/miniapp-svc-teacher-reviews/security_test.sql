begin;

create temporary table teacher_reviews_fixture as
select extensions.gen_random_uuid() as a, extensions.gen_random_uuid() as b, extensions.gen_random_uuid() as c,
  extensions.gen_random_uuid() as t1, extensions.gen_random_uuid() as t2, extensions.gen_random_uuid() as t3,
  extensions.gen_random_uuid() as g1, extensions.gen_random_uuid() as d1, extensions.gen_random_uuid() as d2,
  extensions.gen_random_uuid() as i1, extensions.gen_random_uuid() as i2, extensions.gen_random_uuid() as i3;
insert into auth.users(id, aud, role) select a, 'authenticated', 'authenticated' from teacher_reviews_fixture
  union all select b, 'authenticated', 'authenticated' from teacher_reviews_fixture
  union all select c, 'authenticated', 'authenticated' from teacher_reviews_fixture;
insert into core.term(id, organization_id, starts_on, ends_on) values (99991, 'mirea', miniapp_teacher_reviews.today() - 30, miniapp_teacher_reviews.today() + 120);
insert into core.schedule_teachers(id, organization_id, full_name)
  select t1, 'mirea', 'Тестовый Иван Иванович' from teacher_reviews_fixture
  union all select t2, 'mirea', 'Проверочная Мария Сергеевна' from teacher_reviews_fixture
  union all select t3, 'mirea', 'Контрольный Пётр Петрович' from teacher_reviews_fixture;
insert into core.schedule_groups(id, organization_id, name) select g1, 'mirea', 'ТЕСТ-01-24' from teacher_reviews_fixture;
insert into core.schedule_disciplines(id, organization_id, name)
  select d1, 'mirea', 'Тестовая математика' from teacher_reviews_fixture
  union all select d2, 'mirea', 'Тестовая физика' from teacher_reviews_fixture;
insert into core.schedule_item(id, organization_id, term_id, kind, title, discipline_id, start_time, end_time, dates)
  select i1, 'mirea', 99991, 'lesson', 'Тестовая математика', d1, '10:40'::time, '12:10'::time, array[miniapp_teacher_reviews.today(), miniapp_teacher_reviews.today() + 7] from teacher_reviews_fixture
  union all select i2, 'mirea', 99991, 'lesson', 'Тестовая физика', d2, '12:40'::time, '14:10'::time, array[miniapp_teacher_reviews.today() + 1] from teacher_reviews_fixture
  union all select i3, 'mirea', 99991, 'lesson', 'Тестовая математика', d1, '09:00'::time, '10:30'::time, array[miniapp_teacher_reviews.today() + 2] from teacher_reviews_fixture;
insert into core.schedule_item_teacher(item_id, teacher_id)
  select i1, t1 from teacher_reviews_fixture union all select i2, t2 from teacher_reviews_fixture union all select i3, t3 from teacher_reviews_fixture;
insert into core.schedule_item_group(item_id, group_id)
  select i1, g1 from teacher_reviews_fixture union all select i2, g1 from teacher_reviews_fixture;
insert into core.user_academic_profiles(user_id, organization_id, handle, academic_group, full_name)
  select a, 'mirea', 'tester', 'ТЕСТ-01-24', 'Тестов Тест Тестович' from teacher_reviews_fixture;
grant select on teacher_reviews_fixture to service_role;
set local role service_role;

do $$
declare
  a uuid := (select f.a from teacher_reviews_fixture f);
  b uuid := (select f.b from teacher_reviews_fixture f);
  c uuid := (select f.c from teacher_reviews_fixture f);
  t1 uuid := (select f.t1 from teacher_reviews_fixture f);
  t2 uuid := (select f.t2 from teacher_reviews_fixture f);
  t3 uuid := (select f.t3 from teacher_reviews_fixture f);
  result jsonb;
  v_review_id uuid;
  failed boolean;
  i integer;
begin
  assert current_user = 'service_role';
  assert not has_schema_privilege('anon', 'miniapp_teacher_reviews', 'usage');
  assert not has_schema_privilege('authenticated', 'miniapp_teacher_reviews', 'usage');
  assert not has_function_privilege('anon', 'public.miniapp_teacher_reviews_dispatch(uuid,text,jsonb)', 'execute');
  assert not has_function_privilege('authenticated', 'public.miniapp_teacher_reviews_dispatch(uuid,text,jsonb)', 'execute');
  assert (select bool_and(relrowsecurity) from pg_class x join pg_namespace n on n.oid = x.relnamespace where n.nspname = 'miniapp_teacher_reviews' and x.relkind = 'r');
  assert not (select bool_or(prosecdef) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'miniapp_teacher_reviews');
  assert not (select prosecdef from pg_proc where oid = 'public.miniapp_teacher_reviews_dispatch(uuid,text,jsonb)'::regprocedure);

  failed := false;
  begin
    perform public.miniapp_teacher_reviews_dispatch(extensions.gen_random_uuid(), 'state');
  exception when insufficient_privilege then failed := true;
  end;
  assert failed;

  result := public.miniapp_teacher_reviews_dispatch(a, 'state', '{"view":"home"}');
  assert result -> 'me' ->> 'has_group' = 'true';
  assert result -> 'me' ->> 'group_name' = 'ТЕСТ-01-24';
  assert result -> 'me' ->> 'reviews' = '0';
  assert result -> 'me' -> 'level' ->> 'name' = 'Новичок';
  assert jsonb_array_length(result -> 'me' -> 'badges') = 9;
  assert exists (select 1 from jsonb_array_elements(result -> 'today') x where x ->> 'id' = t1::text);
  assert not exists (select 1 from jsonb_array_elements(result -> 'today') x where x ->> 'id' = t2::text);
  assert (select count(*) = 2 from jsonb_array_elements(result -> 'recommend'));
  assert result -> 'recommend' -> 0 ->> 'id' = t1::text;
  assert result -> 'recommend' -> 0 ->> 'today' = 'true';
  assert result -> 'top' = '[]'::jsonb;
  assert exists (select 1 from miniapp_teacher_reviews.snapshot_days where day = miniapp_teacher_reviews.today());

  result := public.miniapp_teacher_reviews_dispatch(b, 'state', '{"view":"home"}');
  assert result -> 'me' ->> 'has_group' = 'false';
  assert result -> 'recommend' = '[]'::jsonb;

  result := public.miniapp_teacher_reviews_dispatch(a, 'review', jsonb_build_object('id', t1, 'clarity', 5, 'loyalty', 4, 'usefulness', 5,
    'body', 'Объясняет сложные темы простыми словами, всегда отвечает на вопросы и даёт примеры из практики.', 'anonymous', false));
  assert result ->> 'ok' = 'true';
  assert result ->> 'first' = 'true';
  assert result ->> 'pioneer' = 'true';
  assert result ->> 'points' = '15';
  select id into v_review_id from core.teacher_reviews where user_id = a;
  assert v_review_id is not null;

  result := public.miniapp_teacher_reviews_dispatch(a, 'review', jsonb_build_object('id', t1, 'clarity', 5, 'loyalty', 4, 'usefulness', 5,
    'body', 'Объясняет сложные темы простыми словами, всегда отвечает на вопросы и даёт примеры из практики.', 'anonymous', false));
  assert result ->> 'first' = 'false';
  assert (select uses from miniapp_teacher_reviews.daily_usage where user_id = a and action = 'review') = 1;
  assert (select count(*) from core.teacher_reviews where user_id = a) = 1;

  failed := false;
  begin
    perform public.miniapp_teacher_reviews_dispatch(a, 'review', jsonb_build_object('id', t1, 'clarity', 6, 'loyalty', 4, 'usefulness', 5));
  exception when invalid_parameter_value then failed := true;
  end;
  assert failed;
  failed := false;
  begin
    perform public.miniapp_teacher_reviews_dispatch(a, 'review', jsonb_build_object('id', t1, 'clarity', 4, 'loyalty', 4, 'usefulness', 5, 'body', '{{state.secret}}'));
  exception when invalid_parameter_value then failed := true;
  end;
  assert failed;
  failed := false;
  begin
    perform public.miniapp_teacher_reviews_dispatch(a, 'review', jsonb_build_object('id', extensions.gen_random_uuid(), 'clarity', 4, 'loyalty', 4, 'usefulness', 5));
  exception when no_data_found then failed := true;
  end;
  assert failed;

  result := public.miniapp_teacher_reviews_dispatch(b, 'review', jsonb_build_object('id', t1, 'clarity', 3, 'loyalty', 3, 'usefulness', 3, 'body', '', 'anonymous', true));
  assert result ->> 'pioneer' = 'false';
  update core.teacher_reviews set created_at = created_at + interval '1 second' where user_id = b;
  result := public.miniapp_teacher_reviews_dispatch(a, 'state', jsonb_build_object('view', 'teacher', 'id', t1));
  assert result -> 'teacher' ->> 'reviews' = '2';
  assert result -> 'teacher' ->> 'rank' = '1';
  assert result -> 'teacher' ->> 'top_days' = '0';
  assert result -> 'teacher' ->> 'mine' = 'true';
  assert result -> 'teacher' -> 'my_review' ->> 'clarity' = '5';
  assert jsonb_array_length(result -> 'teacher' -> 'reviews_list') = 2;
  assert result -> 'teacher' -> 'disciplines' = '["Тестовая математика"]'::jsonb;
  assert result -> 'teacher' ->> 'groups' = '1';
  assert (select sum(x::integer) from jsonb_array_elements_text(result -> 'teacher' -> 'distribution') x) = 2;
  assert exists (select 1 from jsonb_array_elements(result -> 'teacher' -> 'reviews_list') r where r ->> 'author' = 'Аноним');
  assert exists (select 1 from jsonb_array_elements(result -> 'teacher' -> 'reviews_list') r where r ->> 'author' = 'Тестов Т.');
  assert result -> 'teacher' -> 'similar' = '[]'::jsonb;

  insert into miniapp_teacher_reviews.leaderboard_days(day, kind, subject, rank, score)
  values (miniapp_teacher_reviews.today(), 'teachers', 'Тестовый Иван Иванович', 1, 4.5),
    (miniapp_teacher_reviews.today() - 1, 'teachers', 'Тестовый Иван Иванович', 3, 4.4),
    (miniapp_teacher_reviews.today() - 2, 'teachers', 'Тестовый Иван Иванович', 9, 4.4),
    (miniapp_teacher_reviews.today() - 4, 'teachers', 'Тестовый Иван Иванович', 2, 4.4),
    (miniapp_teacher_reviews.today() - 5, 'teachers', 'Тестовый Иван Иванович', 2, 4.4),
    (miniapp_teacher_reviews.today() - 6, 'teachers', 'Тестовый Иван Иванович', 2, 4.4),
    (miniapp_teacher_reviews.today() - 7, 'teachers', 'Тестовый Иван Иванович', 2, 4.4);
  assert miniapp_teacher_reviews.streak('teachers', 'Тестовый Иван Иванович') = 3;
  assert miniapp_teacher_reviews.best_streak('teachers', 'Тестовый Иван Иванович') = 4;
  result := public.miniapp_teacher_reviews_dispatch(a, 'state', jsonb_build_object('view', 'teacher', 'id', t1));
  assert result -> 'teacher' ->> 'top_days' = '3';
  assert result -> 'teacher' ->> 'best_days' = '4';

  failed := false;
  begin
    perform public.miniapp_teacher_reviews_dispatch(a, 'vote', jsonb_build_object('id', v_review_id, 'helpful', true));
  exception when invalid_parameter_value then failed := true;
  end;
  assert failed;
  result := public.miniapp_teacher_reviews_dispatch(b, 'vote', jsonb_build_object('id', v_review_id, 'helpful', true));
  assert result ->> 'helpful' = '1';
  perform public.miniapp_teacher_reviews_dispatch(b, 'vote', jsonb_build_object('id', v_review_id, 'helpful', true));
  assert (select count(*) from miniapp_teacher_reviews.review_votes where review_id = v_review_id) = 1;
  assert (select uses from miniapp_teacher_reviews.daily_usage where user_id = b and action = 'vote') = 1;
  result := public.miniapp_teacher_reviews_dispatch(a, 'state', '{"view":"me"}');
  assert result -> 'me' ->> 'points' = '20';
  assert result -> 'me' ->> 'helpful' = '1';
  assert result -> 'me' ->> 'rank' = '1';
  assert jsonb_array_length(result -> 'my_reviews') = 1;
  assert result -> 'my_reviews' -> 0 -> 'card' ->> 'id' = t1::text;
  assert exists (select 1 from jsonb_array_elements(result -> 'me' -> 'badges') x where x ->> 'id' = 'pioneer' and x ->> 'earned' = 'true');
  assert exists (select 1 from jsonb_array_elements(result -> 'me' -> 'badges') x where x ->> 'id' = 'five' and x ->> 'earned' = 'false' and x ->> 'progress' = '1');
  result := public.miniapp_teacher_reviews_dispatch(b, 'vote', jsonb_build_object('id', v_review_id, 'helpful', false));
  assert result ->> 'helpful' = '0';
  failed := false;
  begin
    perform public.miniapp_teacher_reviews_dispatch(b, 'vote', jsonb_build_object('id', extensions.gen_random_uuid(), 'helpful', true));
  exception when no_data_found then failed := true;
  end;
  assert failed;

  perform public.miniapp_teacher_reviews_dispatch(a, 'follow', jsonb_build_object('id', t2, 'follow', true));
  perform public.miniapp_teacher_reviews_dispatch(a, 'follow', jsonb_build_object('id', t2, 'follow', true));
  assert (select count(*) from miniapp_teacher_reviews.teacher_follows where user_id = a) = 1;
  result := public.miniapp_teacher_reviews_dispatch(a, 'state', '{"view":"me"}');
  assert result -> 'followed' -> 0 ->> 'id' = t2::text;
  assert result -> 'followed' -> 0 ->> 'followed' = 'true';
  result := public.miniapp_teacher_reviews_dispatch(b, 'state', '{"view":"me"}');
  assert result -> 'followed' = '[]'::jsonb;
  perform public.miniapp_teacher_reviews_dispatch(a, 'follow', jsonb_build_object('id', t2, 'follow', false));
  assert (select count(*) from miniapp_teacher_reviews.teacher_follows where user_id = a) = 0;

  result := public.miniapp_teacher_reviews_dispatch(a, 'search', '{"q":"Тестовый Иван"}');
  assert result ->> 'count' = '1';
  assert result -> 'items' -> 0 ->> 'id' = t1::text;
  result := public.miniapp_teacher_reviews_dispatch(a, 'search', '{"q":"тестовая физика"}');
  assert exists (select 1 from jsonb_array_elements(result -> 'items') x where x ->> 'id' = t2::text);
  assert not exists (select 1 from jsonb_array_elements(result -> 'items') x where x ->> 'id' = t1::text);
  result := public.miniapp_teacher_reviews_dispatch(a, 'search', '{"q":"","scope":"group"}');
  assert result ->> 'count' = '2';
  result := public.miniapp_teacher_reviews_dispatch(a, 'search', '{"q":"","scope":"group","with_reviews":true}');
  assert result ->> 'count' = '1';
  result := public.miniapp_teacher_reviews_dispatch(a, 'search', '{"q":"","scope":"reviewed"}');
  assert result ->> 'count' = '1';
  result := public.miniapp_teacher_reviews_dispatch(b, 'search', '{"q":"","scope":"group"}');
  assert result ->> 'count' = '0';
  result := public.miniapp_teacher_reviews_dispatch(a, 'search', '{"q":"%","sort":"name"}');
  assert result ->> 'count' = '0';

  result := public.miniapp_teacher_reviews_dispatch(a, 'top', '{"board":"overall","scope":"all"}');
  assert result ->> 'count' = '1';
  assert result -> 'items' -> 0 ->> 'position' = '1';
  assert result -> 'items' -> 0 ->> 'top_days' = '3';
  result := public.miniapp_teacher_reviews_dispatch(b, 'top', '{"board":"overall","scope":"group"}');
  assert result ->> 'count' = '0';
  result := public.miniapp_teacher_reviews_dispatch(a, 'top', '{"board":"rising","scope":"group"}');
  assert result ->> 'count' = '1';
  failed := false;
  begin
    perform public.miniapp_teacher_reviews_dispatch(a, 'top', '{"board":"__proto__"}');
  exception when invalid_parameter_value then failed := true;
  end;
  assert failed;

  result := public.miniapp_teacher_reviews_dispatch(a, 'state', '{"view":"top"}');
  assert result -> 'board' ->> 'board' = 'overall';
  assert jsonb_array_length(result -> 'students') = 2;
  assert result -> 'students' -> 0 ->> 'mine' = 'true';
  assert result -> 'students' -> 0 ->> 'name' like 'Ниндзя #%';
  perform public.miniapp_teacher_reviews_dispatch(a, 'settings', '{"show_in_leaderboard":true}');
  result := public.miniapp_teacher_reviews_dispatch(b, 'state', '{"view":"top"}');
  assert result -> 'students' -> 0 ->> 'name' = 'Тестов Т.';
  assert result -> 'students' -> 1 ->> 'name' like 'Ниндзя #%';
  failed := false;
  begin
    perform public.miniapp_teacher_reviews_dispatch(a, 'settings', '{"show_in_leaderboard":"yes"}');
  exception when invalid_parameter_value then failed := true;
  end;
  assert failed;

  perform public.miniapp_teacher_reviews_dispatch(c, 'review', jsonb_build_object('id', t3, 'clarity', 4, 'loyalty', 5, 'usefulness', 4));
  result := public.miniapp_teacher_reviews_dispatch(a, 'state', jsonb_build_object('view', 'teacher', 'id', t1));
  assert result -> 'teacher' -> 'similar' -> 0 ->> 'id' = t3::text;
  result := public.miniapp_teacher_reviews_dispatch(a, 'state', '{"view":"recommend"}');
  assert jsonb_array_length(result -> 'recommend') = 1;
  assert result -> 'recommend' -> 0 ->> 'id' = t2::text;
  assert jsonb_array_length(result -> 'reviewed') = 1;
  result := public.miniapp_teacher_reviews_dispatch(a, 'state', jsonb_build_object('view', 'teacher', 'id', extensions.gen_random_uuid()));
  assert result -> 'teacher' = 'null'::jsonb;

  failed := false;
  begin
    perform public.miniapp_teacher_reviews_dispatch(c, 'delete_review', jsonb_build_object('id', t1));
  exception when no_data_found then failed := true;
  end;
  assert failed;
  perform public.miniapp_teacher_reviews_dispatch(b, 'delete_review', jsonb_build_object('id', t1));
  result := public.miniapp_teacher_reviews_dispatch(a, 'state', jsonb_build_object('view', 'teacher', 'id', t1));
  assert result -> 'teacher' ->> 'reviews' = '1';
  assert result -> 'teacher' -> 'rank' = 'null'::jsonb;

  failed := false;
  for i in 1..21 loop
    begin
      perform public.miniapp_teacher_reviews_dispatch(c, 'review', jsonb_build_object('id', t2, 'clarity', 4, 'loyalty', 4, 'usefulness', 4, 'body', 'Версия отзыва номер ' || i));
    exception when raise_exception then failed := true;
    end;
  end loop;
  assert failed;
  assert (select uses from miniapp_teacher_reviews.daily_usage where user_id = c and action = 'review') = 20;
end;
$$;

select 'teacher reviews access, gamification, search and limit tests passed' as result;
rollback;
