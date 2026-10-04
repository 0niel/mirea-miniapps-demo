begin;

create temporary table anti_users as
select i, extensions.gen_random_uuid() as id from generate_series(1, 7) i;
insert into auth.users(id, aud, role) select id, 'authenticated', 'authenticated' from anti_users;
create temporary table anti_teachers as
select i, extensions.gen_random_uuid() as id, 'Антитоп тест ' || lpad(i::text, 2, '0') as name,
  case when i = 1 then 4 when i = 3 then 7 else 5 end as reviews,
  case when i = 1 then 1 when i = 2 then 1 when i = 3 then 2 else 3 end as clarity,
  case when i = 1 then 1 when i = 2 then 4 when i = 3 then 1 else 3 end as loyalty,
  case when i = 1 then 1 when i = 2 then 5 when i = 3 then 2 else 3 end as usefulness
from generate_series(1, 26) i;
insert into core.schedule_teachers(id, organization_id, full_name) select id, 'mirea', name from anti_teachers;
insert into core.teacher_reviews(organization_id, user_id, teacher_name, clarity, loyalty, usefulness)
select 'mirea', u.id, t.name, t.clarity, t.loyalty, t.usefulness
from anti_teachers t join anti_users u on u.i <= t.reviews;

create temporary table anti_group as select extensions.gen_random_uuid() as id, extensions.gen_random_uuid() as item;
insert into core.term(id, organization_id, starts_on, ends_on)
values (99992, 'mirea', miniapp_teacher_reviews.today() - 10, miniapp_teacher_reviews.today() + 100);
insert into core.schedule_groups(id, organization_id, name) select id, 'mirea', 'АНТИ-01-26' from anti_group;
insert into core.user_academic_profiles(user_id, organization_id, academic_group)
select id, 'mirea', 'АНТИ-01-26' from anti_users where i = 1;
insert into core.schedule_item(id, organization_id, term_id, kind, title, dates)
select item, 'mirea', 99992, 'lesson', 'Тест', array[miniapp_teacher_reviews.today()] from anti_group;
insert into core.schedule_item_group(item_id, group_id) select item, id from anti_group;
insert into core.schedule_item_teacher(item_id, teacher_id)
select g.item, t.id from anti_group g cross join anti_teachers t where t.i in (1, 2, 3);

grant select on anti_users, anti_teachers, anti_group to service_role;
set local role service_role;

do $$
declare
  actor uuid := (select id from anti_users where i = 1);
  result jsonb;
  expected jsonb;
  board_name text;
  scope_name text;
  failed boolean;
begin
  assert not has_function_privilege('anon', 'public.miniapp_teacher_reviews_dispatch(uuid,text,jsonb)', 'execute');
  assert not has_function_privilege('authenticated', 'public.miniapp_teacher_reviews_dispatch(uuid,text,jsonb)', 'execute');
  assert not (select bool_or(prosecdef) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'miniapp_teacher_reviews');
  foreach board_name in array array['anti_overall', 'anti_clarity', 'anti_loyalty', 'anti_usefulness'] loop
    foreach scope_name in array array['all', 'group'] loop
      result := public.miniapp_teacher_reviews_dispatch(actor, 'top', jsonb_build_object('board', board_name, 'scope', scope_name));
      assert (result ->> 'count')::integer = case when scope_name = 'all' then 25 else 2 end;
      assert jsonb_array_length(result -> 'items') = case when scope_name = 'all' then 20 else 2 end;
      with summary as (
        select teacher_name, count(*) as n, avg(clarity) as clarity, avg(loyalty) as loyalty,
          avg(usefulness) as usefulness, avg((clarity + loyalty + usefulness) / 3.0) as rating
        from core.teacher_reviews where organization_id = 'mirea' group by teacher_name
      ), scored as (
        select s.*, round((n * rating + 3 * (select avg((clarity + loyalty + usefulness) / 3.0)
          from core.teacher_reviews where organization_id = 'mirea')) / (n + 3), 3) as score
        from summary s where n >= 5
      ), ordered as (
        select t.id from scored s join anti_teachers t on t.name = s.teacher_name
        where scope_name = 'all' or t.i in (1, 2, 3)
        order by case board_name when 'anti_overall' then s.score when 'anti_clarity' then s.clarity
          when 'anti_loyalty' then s.loyalty else s.usefulness end asc nulls last, n desc, teacher_name
        limit 20
      ) select jsonb_agg(id) into expected from ordered;
      assert (select jsonb_agg(x -> 'id' order by ord) from jsonb_array_elements(result -> 'items') with ordinality as e(x, ord)) = expected;
      assert (select bool_and((x ->> 'position')::integer = ord and (x ->> 'reviews')::integer >= 5)
        from jsonb_array_elements(result -> 'items') with ordinality as e(x, ord));
      assert not exists (select 1 from jsonb_array_elements(result -> 'items') x where x ->> 'name' = 'Антитоп тест 01');
    end loop;
    result := public.miniapp_teacher_reviews_dispatch((select id from anti_users where i = 7), 'top', jsonb_build_object('board', board_name, 'scope', 'group'));
    assert result -> 'items' = '[]'::jsonb and result ->> 'count' = '0';
  end loop;
  result := public.miniapp_teacher_reviews_dispatch(actor, 'top', '{"board":"anti_clarity"}');
  assert result -> 'items' -> 0 ->> 'name' = 'Антитоп тест 02';
  result := public.miniapp_teacher_reviews_dispatch(actor, 'top', '{"board":"anti_loyalty"}');
  assert result -> 'items' -> 0 ->> 'name' = 'Антитоп тест 03';
  failed := false;
  begin
    perform public.miniapp_teacher_reviews_dispatch(actor, 'top', '{"board":"anti_unknown"}');
  exception when invalid_parameter_value then failed := true;
  end;
  assert failed;
  failed := false;
  begin
    perform public.miniapp_teacher_reviews_dispatch(actor, 'top', '{"board":"anti_overall","scope":"other"}');
  exception when invalid_parameter_value then failed := true;
  end;
  assert failed;
end;
$$;

select 'Antitop ordering, thresholds, group isolation, bounds and access passed' as result;
rollback;
