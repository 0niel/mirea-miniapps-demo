begin;

create or replace function miniapp_teacher_reviews.board(p_user_id uuid, p_group uuid, p_term integer, p_board text, p_scope text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with base as (
    select t as tr from miniapp_teacher_reviews.teacher_table() t
    where (p_scope <> 'group' or exists (select 1 from miniapp_teacher_reviews.group_teachers(p_group, p_term) g where g.teacher_name = t.teacher_name))
      and case
        when p_board in ('anti_overall', 'anti_clarity', 'anti_loyalty', 'anti_usefulness') then t.reviews >= 5
        when p_board = 'discussed' then t.reviews >= 1
        when p_board = 'rising' then t.recent30 >= 1
        else t.reviews >= 2 end
  ), ordered as (
    select tr, row_number() over (order by
      case p_board
        when 'anti_overall' then (tr).score
        when 'anti_clarity' then (tr).avg_clarity
        when 'anti_loyalty' then (tr).avg_loyalty
        when 'anti_usefulness' then (tr).avg_usefulness
        else null end asc nulls last,
      case p_board
        when 'clarity' then (tr).avg_clarity
        when 'loyalty' then (tr).avg_loyalty
        when 'usefulness' then (tr).avg_usefulness
        when 'discussed' then (tr).reviews
        when 'rising' then (tr).recent30
        when 'overall' then (tr).score
        else null end desc nulls last,
      (tr).reviews desc, (tr).teacher_name) as position
    from base
  )
  select jsonb_build_object(
    'board', p_board,
    'scope', p_scope,
    'count', (select count(*) from ordered),
    'items', coalesce((
      select jsonb_agg(miniapp_teacher_reviews.teacher_card(o.tr, p_user_id, p_group, p_term) || jsonb_build_object('position', o.position) order by o.position)
      from ordered o where o.position <= 20), '[]'::jsonb)
  );
$$;

do $$
declare
  definition text := pg_get_functiondef('miniapp_teacher_reviews.dispatch(uuid,text,jsonb)'::regprocedure);
  original text := $old$v_board not in ('overall', 'clarity', 'loyalty', 'usefulness', 'discussed', 'rising')$old$;
  replacement text := $new$v_board not in ('overall', 'clarity', 'loyalty', 'usefulness', 'discussed', 'rising', 'anti_overall', 'anti_clarity', 'anti_loyalty', 'anti_usefulness')$new$;
begin
  if strpos(definition, replacement) > 0 then return; end if;
  if (length(definition) - length(replace(definition, original, ''))) / length(original) <> 1 then
    raise exception 'Teacher reviews dispatch whitelist changed';
  end if;
  execute replace(definition, original, replacement);
end;
$$;

commit;
