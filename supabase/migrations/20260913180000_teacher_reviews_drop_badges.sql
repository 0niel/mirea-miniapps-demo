begin;

create or replace function miniapp_teacher_reviews.user_stats(p_user_id uuid, p_group uuid, p_term integer)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_reviews integer; v_helpful integer; v_texts integer; v_points integer; v_rank integer; v_show boolean;
  v_group_total integer; v_group_done integer; v_week integer; v_streak integer;
  v_level integer; v_next integer;
  v_names text[] := array['Новичок', 'Наблюдатель', 'Критик', 'Эксперт', 'Легенда'];
  v_emoji text[] := array['🌱', '🔎', '✍️', '🎯', '🏆'];
  v_thresholds integer[] := array[0, 40, 120, 300, 600];
begin
  select coalesce(s.reviews, 0), coalesce(s.helpful, 0), coalesce(s.texts, 0), coalesce(s.points, 0)
  into v_reviews, v_helpful, v_texts, v_points
  from (select 1) x left join miniapp_teacher_reviews.student_points() s on s.user_id = p_user_id;
  select q.rn into v_rank from (
    select p.user_id, rank() over (order by p.points desc, p.reviews desc, p.user_id) as rn
    from miniapp_teacher_reviews.student_points() p where p.points > 0
  ) q where q.user_id = p_user_id;
  select m.show_in_leaderboard into v_show from miniapp_teacher_reviews.members m where m.user_id = p_user_id;
  select count(*), count(*) filter (where exists (
      select 1 from core.teacher_reviews r where r.organization_id = 'mirea' and r.user_id = p_user_id and r.teacher_name = g.teacher_name))
  into v_group_total, v_group_done
  from miniapp_teacher_reviews.group_teachers(p_group, p_term) g;
  select count(*) filter (where created_at >= miniapp_teacher_reviews.week_start())
  into v_week
  from core.teacher_reviews where organization_id = 'mirea' and user_id = p_user_id;
  v_streak := miniapp_teacher_reviews.streak('students', p_user_id::text);
  v_level := (select count(*) from unnest(v_thresholds) t where v_points >= t);
  v_next := case when v_level >= 5 then null else v_thresholds[v_level + 1] end;
  return jsonb_build_object(
    'reviews', v_reviews,
    'helpful', v_helpful,
    'texts', v_texts,
    'points', v_points,
    'rank', v_rank,
    'show_in_leaderboard', coalesce(v_show, false),
    'display_name', miniapp_teacher_reviews.display_name(p_user_id, coalesce(v_show, false)),
    'level', jsonb_build_object(
      'index', v_level,
      'name', v_names[v_level],
      'emoji', v_emoji[v_level],
      'current', v_thresholds[v_level],
      'next', v_next,
      'progress', case when v_next is null then 1 else round((v_points - v_thresholds[v_level])::numeric / (v_next - v_thresholds[v_level]), 3) end
    ),
    'streak_days', v_streak,
    'best_streak', miniapp_teacher_reviews.best_streak('students', p_user_id::text),
    'week_reviews', v_week,
    'week_goal', 2,
    'group_total', v_group_total,
    'group_done', v_group_done,
    'has_group', p_group is not null,
    'group_name', (select academic_group from core.user_academic_profiles where user_id = p_user_id)
  );
end;
$$;

drop function if exists miniapp_teacher_reviews.badge(text, text, text, text, boolean, integer, integer);

commit;
