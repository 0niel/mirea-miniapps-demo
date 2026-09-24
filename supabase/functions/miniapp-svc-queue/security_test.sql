begin;

create schema if not exists internal;
create table internal.queue_test_pushes (
  recipient uuid,
  title text,
  body text,
  route text,
  kind text,
  event_key text
);
create or replace function internal.notify_app_event_once(
  p_recipient uuid, p_title text, p_body text, p_route text, p_kind text, p_event_key text,
  p_created_at timestamptz default now(), p_push boolean default true)
returns void language sql as $$
  insert into internal.queue_test_pushes
  select p_recipient, p_title, p_body, p_route, p_kind, p_event_key
  where not exists (select 1 from internal.queue_test_pushes x where x.event_key = p_event_key and x.recipient = p_recipient);
$$;

create temporary table queue_fixture as
select gen_random_uuid() as a, gen_random_uuid() as b, gen_random_uuid() as c, gen_random_uuid() as d, gen_random_uuid() as e,
  gen_random_uuid() as g1, gen_random_uuid() as d1, gen_random_uuid() as d2, gen_random_uuid() as i1, gen_random_uuid() as i2;
insert into auth.users(id, aud, role)
select x, 'authenticated', 'authenticated' from queue_fixture f, unnest(array[f.a, f.b, f.c, f.d, f.e]) x;
insert into core.term(id, organization_id, starts_on, ends_on)
values (99992, 'mirea', miniapp_queue.today() - 20, miniapp_queue.today() + 100);
insert into core.schedule_groups(id, organization_id, name) select g1, 'mirea', 'ТЕСТ-01-24' from queue_fixture;
insert into core.schedule_disciplines(id, organization_id, name)
select d1, 'mirea', 'Тестовая физика' from queue_fixture union all select d2, 'mirea', 'Тестовый матан' from queue_fixture;
insert into core.schedule_item(id, organization_id, term_id, kind, title, lesson_type, discipline_id, start_time, end_time, dates)
select i1, 'mirea', 99992, 'lesson', 'Тестовая физика', 'laboratoryWork', d1, '12:40'::time, '14:10'::time, array[miniapp_queue.today()] from queue_fixture
union all select i2, 'mirea', 99992, 'lesson', 'Тестовый матан', 'lecture', d2, '09:00'::time, '10:30'::time, array[miniapp_queue.today() + 1, miniapp_queue.today() + 8] from queue_fixture;
insert into core.schedule_item_group(item_id, group_id)
select i1, g1 from queue_fixture union all select i2, g1 from queue_fixture;
insert into core.user_academic_profiles(user_id, organization_id, handle, academic_group, full_name)
select a, 'mirea', 'anna', 'ТЕСТ-01-24', 'Создатель Анна Ивановна' from queue_fixture
union all select b, 'mirea', 'boris', 'ТЕСТ-01-24', 'Второй Борис' from queue_fixture
union all select c, 'mirea', 'clara', null, '' from queue_fixture
union all select e, 'mirea', null, 'ДРУГ-02-24', 'Пятый Егор Петрович' from queue_fixture;
grant select on queue_fixture to service_role;
set local role service_role;

do $$
declare
  a uuid := (select f.a from queue_fixture f);
  b uuid := (select f.b from queue_fixture f);
  c uuid := (select f.c from queue_fixture f);
  d uuid := (select f.d from queue_fixture f);
  e uuid := (select f.e from queue_fixture f);
  r jsonb;
  v_code text;
  v_other text;
  v_entry uuid;
  failed boolean;
  i integer;
begin
  assert current_user = 'service_role';
  assert not has_schema_privilege('anon', 'miniapp_queue', 'usage');
  assert not has_schema_privilege('authenticated', 'miniapp_queue', 'usage');
  assert not has_function_privilege('anon', 'public.miniapp_queue_dispatch(uuid,text,jsonb)', 'execute');
  assert not has_function_privilege('authenticated', 'public.miniapp_queue_dispatch(uuid,text,jsonb)', 'execute');
  assert (select bool_and(relrowsecurity) from pg_class x join pg_namespace n on n.oid = x.relnamespace
    where n.nspname = 'miniapp_queue' and x.relkind = 'r');
  assert (select array_agg(p.proname::text) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'miniapp_queue' and p.prosecdef) = array['notify'];
  assert not has_function_privilege('authenticated', 'miniapp_queue.notify(uuid,text,text,text,text)', 'execute');
  assert not has_schema_privilege('service_role', 'internal', 'usage');

  failed := false;
  begin
    perform public.miniapp_queue_dispatch(gen_random_uuid(), 'create', '{"title":"Призрак"}');
  exception when insufficient_privilege then failed := true;
  end;
  assert failed;
  failed := false;
  begin
    perform public.miniapp_queue_dispatch(null, 'state');
  exception when insufficient_privilege then failed := true;
  end;
  assert failed;

  r := public.miniapp_queue_dispatch(d, 'state', '{"view":"home"}');
  assert r -> 'mine' = '[]'::jsonb and r -> 'owned' = '[]'::jsonb and r -> 'group' = '[]'::jsonb;
  assert r -> 'me' ->> 'has_group' = 'false' and r -> 'me' ->> 'name' like 'Студент #%';

  r := public.miniapp_queue_dispatch(a, 'state', '{"view":"new"}');
  assert jsonb_array_length(r -> 'subjects') = 2;
  assert r -> 'subjects' -> 0 ->> 'name' = 'Тестовая физика';
  assert r -> 'subjects' -> 0 ->> 'today' = 'true' and r -> 'subjects' -> 0 ->> 'lab' = 'true';
  assert r -> 'me' ->> 'name' = 'Создатель Анна';

  failed := false;
  begin
    perform public.miniapp_queue_dispatch(a, 'create', '{"title":"x"}');
  exception when sqlstate '22023' then failed := true;
  end;
  assert failed;
  failed := false;
  begin
    perform public.miniapp_queue_dispatch(a, 'create', '{"title":"Норм","note":"{{state.x}}"}');
  exception when sqlstate '22023' then failed := true;
  end;
  assert failed;

  r := public.miniapp_queue_dispatch(a, 'create', jsonb_build_object('title', 'Физика — лаба 3', 'note', 'Ауд. А-214' || chr(10) || 'По две лабы',
    'mode', 'join', 'capacity', 3, 'group', true, 'join_self', true));
  v_code := r ->> 'code';
  assert r ->> 'ok' = 'true' and v_code ~ '^[2-9A-HJ-NP-Z]{6}$';
  assert (select group_name from miniapp_queue.queues where code = v_code) = 'ТЕСТ-01-24';
  assert (select pos from miniapp_queue.entries e join miniapp_queue.queues q on q.id = e.queue_id where q.code = v_code and e.user_id = a) = 1;

  r := public.miniapp_queue_dispatch(b, 'state', '{"view":"home"}');
  assert r -> 'group' -> 0 ->> 'code' = v_code and r -> 'group' -> 0 ->> 'waiting' = '1';
  r := public.miniapp_queue_dispatch(e, 'state', '{"view":"home"}');
  assert r -> 'group' = '[]'::jsonb;

  r := public.miniapp_queue_dispatch(b, 'resolve', jsonb_build_object('code', lower(v_code)));
  assert r ->> 'code' = v_code;
  failed := false;
  begin
    perform public.miniapp_queue_dispatch(b, 'resolve', '{"code":"ZZZZZZ"}');
  exception when sqlstate 'P0002' then failed := true;
  end;
  assert failed;

  r := public.miniapp_queue_dispatch(b, 'join', jsonb_build_object('code', v_code));
  assert r ->> 'position' = '2';
  r := public.miniapp_queue_dispatch(b, 'join', jsonb_build_object('code', v_code));
  assert r ->> 'ok' = 'false' and r ->> 'message' like '%уже%';
  r := public.miniapp_queue_dispatch(c, 'join', jsonb_build_object('code', v_code, 'note', 'Лаба 4'));
  assert r ->> 'position' = '3';
  r := public.miniapp_queue_dispatch(d, 'join', jsonb_build_object('code', v_code));
  assert r ->> 'ok' = 'false' and r ->> 'message' like '%места%';
  failed := false;
  begin
    perform public.miniapp_queue_dispatch(d, 'join', jsonb_build_object('code', v_code, 'note', repeat('x', 61)));
  exception when sqlstate '22023' then failed := true;
  end;
  assert failed;

  r := public.miniapp_queue_dispatch(c, 'state', jsonb_build_object('view', 'queue', 'code', v_code));
  assert r -> 'queue' -> 'my' ->> 'pos' = '3' and r -> 'queue' -> 'my' ->> 'note' = 'Лаба 4';
  assert r -> 'queue' -> 'my' ->> 'name' = '@clara';
  assert jsonb_array_length(r -> 'queue' -> 'waiting') = 3;
  assert r -> 'queue' -> 'waiting' -> 1 ->> 'name' = 'Второй Борис';
  assert r -> 'queue' ->> 'is_owner' = 'false';
  assert (r -> 'queue' -> 'waiting' -> 0 ->> 'joined_at')::timestamptz < (r -> 'queue' -> 'waiting' -> 2 ->> 'joined_at')::timestamptz;
  assert r -> 'queue' -> 'events' -> 0 ->> 'kind' = 'joined';
  assert exists (select 1 from miniapp_queue.visits v join miniapp_queue.queues q on q.id = v.queue_id where q.code = v_code and v.user_id = c);
  r := public.miniapp_queue_dispatch(d, 'state', jsonb_build_object('view', 'queue', 'code', 'ZZZZZZ'));
  assert r -> 'queue' = 'null'::jsonb;

  r := public.miniapp_queue_dispatch(b, 'let_ahead', jsonb_build_object('code', v_code));
  assert r ->> 'ok' = 'true';
  assert (select pos from miniapp_queue.entries e join miniapp_queue.queues q on q.id = e.queue_id where q.code = v_code and e.user_id = c and e.state = 'waiting') = 2;
  r := public.miniapp_queue_dispatch(b, 'let_ahead', jsonb_build_object('code', v_code));
  assert r ->> 'ok' = 'false';

  failed := false;
  begin
    perform public.miniapp_queue_dispatch(b, 'next', jsonb_build_object('code', v_code));
  exception when insufficient_privilege then failed := true;
  end;
  assert failed;
  failed := false;
  begin
    perform public.miniapp_queue_dispatch(b, 'status', jsonb_build_object('code', v_code, 'status', 'finished'));
  exception when insufficient_privilege then failed := true;
  end;
  assert failed;

  select e.id into v_entry from miniapp_queue.entries e join miniapp_queue.queues q on q.id = e.queue_id where q.code = v_code and e.user_id = c and e.state = 'waiting';
  r := public.miniapp_queue_dispatch(a, 'move', jsonb_build_object('code', v_code, 'entry', v_entry, 'to', 1));
  assert r ->> 'ok' = 'false' and r ->> 'message' like '%времен%';
  r := public.miniapp_queue_dispatch(a, 'shuffle', jsonb_build_object('code', v_code));
  assert r ->> 'ok' = 'false';

  r := public.miniapp_queue_dispatch(c, 'start', jsonb_build_object('code', v_code));
  assert r ->> 'ok' = 'false';
  r := public.miniapp_queue_dispatch(a, 'next', jsonb_build_object('code', v_code));
  assert r ->> 'ok' = 'true';
  assert (select state from miniapp_queue.entries e join miniapp_queue.queues q on q.id = e.queue_id where q.code = v_code and e.user_id = a) = 'current';
  r := public.miniapp_queue_dispatch(c, 'done', jsonb_build_object('code', v_code));
  assert r ->> 'ok' = 'false' and r ->> 'message' like '%не вызвали%';
  r := public.miniapp_queue_dispatch(a, 'done', jsonb_build_object('code', v_code));
  assert r ->> 'ok' = 'true';
  assert (select state from miniapp_queue.entries e join miniapp_queue.queues q on q.id = e.queue_id where q.code = v_code and e.user_id = c and e.state in ('waiting', 'current')) = 'current';
  assert (select pos from miniapp_queue.entries e join miniapp_queue.queues q on q.id = e.queue_id where q.code = v_code and e.user_id = b and e.state = 'waiting') = 1;

  r := public.miniapp_queue_dispatch(b, 'state', '{"view":"home"}');
  assert r -> 'mine' -> 0 ->> 'my_pos' = '1' and r -> 'mine' -> 0 ->> 'current_name' = '@clara';

  r := public.miniapp_queue_dispatch(a, 'skip', jsonb_build_object('code', v_code, 'entry', v_entry));
  assert r ->> 'ok' = 'true' and r ->> 'position' = '2';
  assert (select state from miniapp_queue.entries where id = v_entry) = 'waiting';
  assert (select pos from miniapp_queue.entries where id = v_entry) = 1;
  assert (select state from miniapp_queue.entries e join miniapp_queue.queues q on q.id = e.queue_id where q.code = v_code and e.user_id = b and e.state in ('waiting', 'current')) = 'current';
  r := public.miniapp_queue_dispatch(a, 'remove', jsonb_build_object('code', v_code, 'entry', v_entry));
  assert (select state from miniapp_queue.entries where id = v_entry) = 'removed';

  r := public.miniapp_queue_dispatch(a, 'status', jsonb_build_object('code', v_code, 'status', 'closed'));
  r := public.miniapp_queue_dispatch(d, 'join', jsonb_build_object('code', v_code));
  assert r ->> 'ok' = 'false' and r ->> 'message' like '%закрыл%';
  r := public.miniapp_queue_dispatch(a, 'edit', jsonb_build_object('code', v_code, 'title', 'Физика — лаба 3', 'note', '', 'mode', 'owner', 'capacity', null, 'group', true));
  assert (select mode from miniapp_queue.queues where code = v_code) = 'owner';
  assert (select capacity from miniapp_queue.queues where code = v_code) is null;
  assert exists (select 1 from miniapp_queue.events v join miniapp_queue.queues q on q.id = v.queue_id where q.code = v_code and v.kind = 'mode' and v.to_pos = 1);
  r := public.miniapp_queue_dispatch(a, 'status', jsonb_build_object('code', v_code, 'status', 'open'));
  perform public.miniapp_queue_dispatch(d, 'join', jsonb_build_object('code', v_code));
  perform public.miniapp_queue_dispatch(e, 'join', jsonb_build_object('code', v_code));
  r := public.miniapp_queue_dispatch(c, 'join', jsonb_build_object('code', v_code));
  assert r ->> 'position' = '3';
  select e.id into v_entry from miniapp_queue.entries e join miniapp_queue.queues q on q.id = e.queue_id where q.code = v_code and e.user_id = c and e.state = 'waiting';
  r := public.miniapp_queue_dispatch(a, 'move', jsonb_build_object('code', v_code, 'entry', v_entry, 'to', 1));
  assert r ->> 'ok' = 'true' and r ->> 'position' = '1';
  assert (select array_agg(e.user_id order by e.pos) from miniapp_queue.entries e join miniapp_queue.queues q on q.id = e.queue_id
    where q.code = v_code and e.state = 'waiting') = array[c, d, e];
  assert (select moved_by_owner from miniapp_queue.entries where id = v_entry);
  r := public.miniapp_queue_dispatch(a, 'move', jsonb_build_object('code', v_code, 'entry', v_entry, 'to', 99));
  assert (select pos from miniapp_queue.entries where id = v_entry) = 3;
  r := public.miniapp_queue_dispatch(a, 'shuffle', jsonb_build_object('code', v_code));
  assert r ->> 'ok' = 'true';
  assert (select array_agg(e.pos order by e.pos) from miniapp_queue.entries e join miniapp_queue.queues q on q.id = e.queue_id
    where q.code = v_code and e.state = 'waiting') = array[1, 2, 3];
  r := public.miniapp_queue_dispatch(b, 'leave', jsonb_build_object('code', v_code));
  assert r ->> 'ok' = 'true';
  assert (select count(*) from miniapp_queue.entries e join miniapp_queue.queues q on q.id = e.queue_id where q.code = v_code and e.state = 'current') = 1;
  assert (select count(*) from miniapp_queue.entries e join miniapp_queue.queues q on q.id = e.queue_id where q.code = v_code and e.state = 'waiting') = 2;

  r := public.miniapp_queue_dispatch(c, 'note', jsonb_build_object('code', v_code, 'note', 'Только отчёт'));
  r := public.miniapp_queue_dispatch(a, 'state', jsonb_build_object('view', 'history', 'code', v_code));
  assert r -> 'queue' ->> 'is_owner' = 'true';
  assert (r -> 'queue' ->> 'events_total')::integer = jsonb_array_length(r -> 'queue' -> 'events');
  assert (r -> 'queue' ->> 'events_total')::integer >= 20;
  assert (r -> 'queue' ->> 'shuffles')::integer = 1;
  assert r -> 'queue' -> 'events' -> -1 ->> 'kind' = 'created';

  r := public.miniapp_queue_dispatch(b, 'create', jsonb_build_object('title', 'Английский', 'mode', 'join',
    'opens_at', (now() + interval '1 hour')::text));
  v_other := r ->> 'code';
  r := public.miniapp_queue_dispatch(c, 'join', jsonb_build_object('code', v_other));
  assert r ->> 'ok' = 'false' and r ->> 'message' like '%не открылась%';
  r := public.miniapp_queue_dispatch(b, 'create', jsonb_build_object('title', 'Английский 2', 'join_self', true,
    'opens_at', (now() + interval '1 hour')::text));
  assert not exists (select 1 from miniapp_queue.entries e join miniapp_queue.queues q on q.id = e.queue_id where q.code = r ->> 'code');

  r := public.miniapp_queue_dispatch(a, 'delete', jsonb_build_object('code', v_code));
  assert r ->> 'ok' = 'false';
  r := public.miniapp_queue_dispatch(a, 'status', jsonb_build_object('code', v_code, 'status', 'finished'));
  r := public.miniapp_queue_dispatch(e, 'leave', jsonb_build_object('code', v_code));
  r := public.miniapp_queue_dispatch(d, 'join', jsonb_build_object('code', v_code));
  assert r ->> 'ok' = 'false' and r ->> 'message' like '%завершена%';
  r := public.miniapp_queue_dispatch(d, 'state', '{"view":"home"}');
  assert r -> 'mine' = '[]'::jsonb and r -> 'archive' -> 0 ->> 'code' = v_code;
  r := public.miniapp_queue_dispatch(a, 'reset', jsonb_build_object('code', v_code));
  assert (select status from miniapp_queue.queues where code = v_code) = 'open';
  assert not exists (select 1 from miniapp_queue.entries e join miniapp_queue.queues q on q.id = e.queue_id where q.code = v_code and e.state in ('waiting', 'current'));
  r := public.miniapp_queue_dispatch(a, 'state', jsonb_build_object('view', 'queue', 'code', v_code));
  assert r -> 'queue' -> 'done_list' = '[]'::jsonb and r -> 'queue' -> 'counts' ->> 'done' = '0';
  r := public.miniapp_queue_dispatch(a, 'delete', jsonb_build_object('code', v_code));
  assert r ->> 'ok' = 'true' and not exists (select 1 from miniapp_queue.queues where code = v_code);

  for i in 1..20 loop
    r := public.miniapp_queue_dispatch(e, 'create', jsonb_build_object('title', 'Очередь ' || i));
    exit when r ->> 'ok' = 'false';
  end loop;
  assert r ->> 'ok' = 'false' and r ->> 'message' like '%15%';
  assert (select count(*) from miniapp_queue.queues where owner_id = e) = 15;

  update miniapp_queue.queues set updated_at = now() - interval '4 days' where owner_id = e;
  perform miniapp_queue.cleanup();
  assert not exists (select 1 from miniapp_queue.queues where owner_id = e and status <> 'finished');
  assert (select count(*) from miniapp_queue.events v join miniapp_queue.queues q on q.id = v.queue_id
    where q.owner_id = e and v.kind = 'finished' and v.actor_id is null) = 15;
  assert exists (select 1 from miniapp_queue.queues where code = v_other and status = 'open');
end;
$$;

reset role;
do $$
declare
  c uuid := (select f.c from queue_fixture f);
  a uuid := (select f.a from queue_fixture f);
begin
  assert exists (select 1 from internal.queue_test_pushes where recipient = c and title like 'Вас пропустили вперёд%');
  assert exists (select 1 from internal.queue_test_pushes where recipient = c and title like 'Ваша очередь%');
  assert exists (select 1 from internal.queue_test_pushes where recipient = c and title like 'Вы следующий%');
  assert exists (select 1 from internal.queue_test_pushes where recipient = c and title = 'Вас перенесли в конец очереди');
  assert exists (select 1 from internal.queue_test_pushes where recipient = c and title = 'Вас убрали из очереди');
  assert exists (select 1 from internal.queue_test_pushes where recipient = c and title = 'Ваше место изменилось');
  assert (select count(*) from internal.queue_test_pushes where title like 'Порядок перемешан%') = 3;
  assert not exists (select 1 from internal.queue_test_pushes where recipient = a and title like 'Ваша очередь%');
  assert (select bool_and(kind = 'queue' and route like '/services/apps/queue/run?page=%2Fq%3Fcode%3D%') from internal.queue_test_pushes);
  assert (select count(*) = count(distinct (recipient, event_key)) from internal.queue_test_pushes);
end;
$$;

rollback;
