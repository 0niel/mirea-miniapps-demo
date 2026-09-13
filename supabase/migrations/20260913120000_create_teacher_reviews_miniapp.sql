begin;

create schema if not exists miniapp_teacher_reviews;
revoke all on schema miniapp_teacher_reviews from public, anon, authenticated;
grant usage on schema miniapp_teacher_reviews to service_role;

create table miniapp_teacher_reviews.members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  show_in_leaderboard boolean not null default false,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create table miniapp_teacher_reviews.review_votes (
  user_id uuid not null references auth.users(id) on delete cascade,
  review_id uuid not null references core.teacher_reviews(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, review_id)
);
create index teacher_review_votes_review on miniapp_teacher_reviews.review_votes(review_id);
create table miniapp_teacher_reviews.teacher_follows (
  user_id uuid not null references auth.users(id) on delete cascade,
  teacher_name text not null check (char_length(teacher_name) between 1 and 200),
  created_at timestamptz not null default now(),
  primary key (user_id, teacher_name)
);
create table miniapp_teacher_reviews.daily_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  action text not null check (action in ('review','vote','follow')),
  uses integer not null check (uses > 0),
  primary key (user_id, usage_date, action)
);
create table miniapp_teacher_reviews.snapshot_days (
  day date primary key,
  created_at timestamptz not null default now()
);
create table miniapp_teacher_reviews.leaderboard_days (
  day date not null,
  kind text not null check (kind in ('teachers','students')),
  subject text not null,
  rank integer not null check (rank between 1 and 100),
  score numeric not null,
  primary key (day, kind, subject)
);
create index teacher_reviews_leaderboard_subject on miniapp_teacher_reviews.leaderboard_days(kind, subject, day desc);

alter table miniapp_teacher_reviews.members enable row level security;
alter table miniapp_teacher_reviews.review_votes enable row level security;
alter table miniapp_teacher_reviews.teacher_follows enable row level security;
alter table miniapp_teacher_reviews.daily_usage enable row level security;
alter table miniapp_teacher_reviews.snapshot_days enable row level security;
alter table miniapp_teacher_reviews.leaderboard_days enable row level security;
revoke all on all tables in schema miniapp_teacher_reviews from public, anon, authenticated;
grant select, insert, update, delete on all tables in schema miniapp_teacher_reviews to service_role;

create type miniapp_teacher_reviews.teacher_row as (
  teacher_id uuid,
  teacher_name text,
  reviews integer,
  avg_all numeric,
  avg_clarity numeric,
  avg_loyalty numeric,
  avg_usefulness numeric,
  score numeric,
  last_review_at timestamptz,
  recent30 integer,
  rank_overall integer,
  rank_clarity integer,
  rank_loyalty integer,
  rank_usefulness integer,
  rank_discussed integer,
  rank_rising integer
);

create function miniapp_teacher_reviews.today()
returns date language sql stable security invoker set search_path = '' as $$
  select (now() at time zone 'Europe/Moscow')::date;
$$;

create function miniapp_teacher_reviews.week_start()
returns date language sql stable security invoker set search_path = '' as $$
  select date_trunc('week', now() at time zone 'Europe/Moscow')::date;
$$;

create function miniapp_teacher_reviews.current_term()
returns integer language sql stable security invoker set search_path = '' as $$
  select id from core.term
  where organization_id = 'mirea' and starts_on <= miniapp_teacher_reviews.today()
  order by starts_on desc limit 1;
$$;

create function miniapp_teacher_reviews.user_group(p_user_id uuid)
returns uuid language sql stable security invoker set search_path = '' as $$
  select g.id from core.user_academic_profiles p
  join core.schedule_groups g on g.organization_id = 'mirea' and g.name = p.academic_group
  where p.user_id = p_user_id
  order by g.id limit 1;
$$;

create function miniapp_teacher_reviews.short_name(p_full text)
returns text language sql immutable security invoker set search_path = '' as $$
  select case
    when p_full is null or btrim(p_full) = '' then null
    when split_part(btrim(p_full), ' ', 2) = '' then split_part(btrim(p_full), ' ', 1)
    else split_part(btrim(p_full), ' ', 1) || ' ' || left(split_part(btrim(p_full), ' ', 2), 1) || '.'
  end;
$$;

create function miniapp_teacher_reviews.author_label(p_user_id uuid, p_anonymous boolean)
returns text language sql stable security invoker set search_path = '' as $$
  select case when p_anonymous then 'Аноним'
    else coalesce((select miniapp_teacher_reviews.short_name(pr.full_name) from core.user_academic_profiles pr where pr.user_id = p_user_id), 'Студент')
  end;
$$;

create function miniapp_teacher_reviews.display_name(p_user_id uuid, p_show boolean)
returns text language sql stable security invoker set search_path = '' as $$
  select case when p_show then miniapp_teacher_reviews.author_label(p_user_id, false)
    else 'Ниндзя #' || upper(left(md5(p_user_id::text), 4)) end;
$$;

create function miniapp_teacher_reviews.badge(p_id text, p_title text, p_emoji text, p_hint text, p_earned boolean, p_progress integer, p_goal integer)
returns jsonb language sql immutable security invoker set search_path = '' as $$
  select jsonb_build_object('id', p_id, 'title', p_title, 'emoji', p_emoji, 'hint', p_hint, 'earned', p_earned, 'progress', least(p_progress, p_goal), 'goal', p_goal);
$$;

create function miniapp_teacher_reviews.teacher_table()
returns setof miniapp_teacher_reviews.teacher_row language sql stable security invoker set search_path = '' as $$
  with names as (
    select full_name as teacher_name, (array_agg(id order by id))[1] as teacher_id
    from core.schedule_teachers where organization_id = 'mirea' group by full_name
    union all
    select r.teacher_name, md5('mirea:' || r.teacher_name)::uuid
    from core.teacher_reviews r
    where r.organization_id = 'mirea'
      and not exists (select 1 from core.schedule_teachers t where t.organization_id = 'mirea' and t.full_name = r.teacher_name)
    group by r.teacher_name
  ), stats as (
    select teacher_name, count(*)::integer as reviews,
      avg((clarity + loyalty + usefulness) / 3.0) as avg_all,
      avg(clarity) as avg_clarity, avg(loyalty) as avg_loyalty, avg(usefulness) as avg_usefulness,
      max(created_at) as last_review_at,
      count(*) filter (where created_at > now() - interval '30 days')::integer as recent30
    from core.teacher_reviews where organization_id = 'mirea' group by teacher_name
  ), prior as (
    select coalesce(avg((clarity + loyalty + usefulness) / 3.0), 4)::numeric as mean
    from core.teacher_reviews where organization_id = 'mirea'
  ), joined as (
    select n.teacher_id, n.teacher_name, coalesce(s.reviews, 0) as reviews,
      s.avg_all, s.avg_clarity, s.avg_loyalty, s.avg_usefulness,
      case when s.reviews is null then null else round((s.reviews * s.avg_all + 3 * p.mean) / (s.reviews + 3), 3) end as score,
      s.last_review_at, coalesce(s.recent30, 0) as recent30
    from names n left join stats s using (teacher_name) cross join prior p
  )
  select teacher_id, teacher_name, reviews,
    round(avg_all, 2), round(avg_clarity, 2), round(avg_loyalty, 2), round(avg_usefulness, 2),
    score, last_review_at, recent30,
    (case when reviews >= 2 then rank() over (partition by reviews >= 2 order by score desc, reviews desc, teacher_name) end)::integer,
    (case when reviews >= 2 then rank() over (partition by reviews >= 2 order by avg_clarity desc, reviews desc, teacher_name) end)::integer,
    (case when reviews >= 2 then rank() over (partition by reviews >= 2 order by avg_loyalty desc, reviews desc, teacher_name) end)::integer,
    (case when reviews >= 2 then rank() over (partition by reviews >= 2 order by avg_usefulness desc, reviews desc, teacher_name) end)::integer,
    (case when reviews >= 1 then rank() over (partition by reviews >= 1 order by reviews desc, last_review_at desc, teacher_name) end)::integer,
    (case when recent30 >= 1 then rank() over (partition by recent30 >= 1 order by recent30 desc, score desc nulls last, teacher_name) end)::integer
  from joined;
$$;

create function miniapp_teacher_reviews.student_points()
returns table (user_id uuid, reviews integer, helpful integer, texts integer, points integer)
language sql stable security invoker set search_path = '' as $$
  with r as (
    select user_id, count(*)::integer as reviews, count(*) filter (where char_length(body) >= 60)::integer as texts
    from core.teacher_reviews where organization_id = 'mirea' group by user_id
  ), v as (
    select x.user_id, count(*)::integer as helpful
    from miniapp_teacher_reviews.review_votes rv join core.teacher_reviews x on x.id = rv.review_id
    group by x.user_id
  )
  select r.user_id, r.reviews, coalesce(v.helpful, 0), r.texts, r.reviews * 10 + coalesce(v.helpful, 0) * 5 + r.texts * 5
  from r left join v using (user_id);
$$;

create function miniapp_teacher_reviews.streak(p_kind text, p_subject text, p_max_rank integer default 10)
returns integer language sql stable security invoker set search_path = '' as $$
  select count(*)::integer from (
    select day, row_number() over (order by day desc) as rn
    from miniapp_teacher_reviews.leaderboard_days
    where kind = p_kind and subject = p_subject and rank <= p_max_rank and day <= miniapp_teacher_reviews.today()
  ) s where s.day = miniapp_teacher_reviews.today() - (s.rn - 1)::integer;
$$;

create function miniapp_teacher_reviews.best_streak(p_kind text, p_subject text, p_max_rank integer default 10)
returns integer language sql stable security invoker set search_path = '' as $$
  select coalesce(max(c), 0)::integer from (
    select count(*) as c from (
      select day - (row_number() over (order by day))::integer as grp
      from miniapp_teacher_reviews.leaderboard_days
      where kind = p_kind and subject = p_subject and rank <= p_max_rank
    ) s group by grp
  ) g;
$$;

create function miniapp_teacher_reviews.ensure_snapshot()
returns void language plpgsql security invoker set search_path = '' as $$
declare d date := miniapp_teacher_reviews.today();
begin
  if exists (select 1 from miniapp_teacher_reviews.snapshot_days where day = d) then return; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('miniapp_teacher_reviews:snapshot', 0));
  if exists (select 1 from miniapp_teacher_reviews.snapshot_days where day = d) then return; end if;
  insert into miniapp_teacher_reviews.leaderboard_days(day, kind, subject, rank, score)
  select d, 'teachers', teacher_name, rank_overall, score
  from miniapp_teacher_reviews.teacher_table() where rank_overall between 1 and 10
  on conflict do nothing;
  insert into miniapp_teacher_reviews.leaderboard_days(day, kind, subject, rank, score)
  select d, 'students', s.user_id::text, s.rn, s.points from (
    select p.user_id, p.points, rank() over (order by p.points desc, p.reviews desc, p.user_id) as rn
    from miniapp_teacher_reviews.student_points() p where p.points > 0
  ) s where s.rn <= 10
  on conflict do nothing;
  insert into miniapp_teacher_reviews.snapshot_days(day) values (d) on conflict do nothing;
end;
$$;

create function miniapp_teacher_reviews.consume(p_user_id uuid, p_action text, p_limit integer)
returns void language plpgsql security invoker set search_path = '' as $$
declare used integer;
begin
  insert into miniapp_teacher_reviews.daily_usage(user_id, usage_date, action, uses)
  values (p_user_id, miniapp_teacher_reviews.today(), p_action, 1)
  on conflict (user_id, usage_date, action) do update set uses = miniapp_teacher_reviews.daily_usage.uses + 1
  where miniapp_teacher_reviews.daily_usage.uses < p_limit
  returning uses into used;
  if used is null then raise exception 'Daily limit reached' using errcode = 'P0001'; end if;
end;
$$;

create function miniapp_teacher_reviews.resolve_teacher(p_id uuid)
returns text language sql stable security invoker set search_path = '' as $$
  select coalesce(
    (select full_name from core.schedule_teachers where organization_id = 'mirea' and id = p_id),
    (select teacher_name from core.teacher_reviews where organization_id = 'mirea' and md5('mirea:' || teacher_name)::uuid = p_id limit 1)
  );
$$;

create function miniapp_teacher_reviews.group_teachers(p_group uuid, p_term integer)
returns table (teacher_name text, occurrences integer, today boolean, first_time time, subject text)
language sql stable security invoker set search_path = '' as $$
  select t.full_name, sum(cardinality(si.dates))::integer,
    bool_or(miniapp_teacher_reviews.today() = any(si.dates)),
    min(si.start_time) filter (where miniapp_teacher_reviews.today() = any(si.dates)),
    min(si.title) filter (where miniapp_teacher_reviews.today() = any(si.dates))
  from core.schedule_item si
  join core.schedule_item_group ig on ig.item_id = si.id
  join core.schedule_item_teacher it on it.item_id = si.id
  join core.schedule_teachers t on t.id = it.teacher_id
  where p_group is not null and ig.group_id = p_group and si.term_id = p_term and si.kind = 'lesson'
  group by t.full_name;
$$;

create function miniapp_teacher_reviews.teacher_card(r miniapp_teacher_reviews.teacher_row, p_user_id uuid, p_group uuid, p_term integer)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'id', r.teacher_id,
    'name', r.teacher_name,
    'reviews', r.reviews,
    'rating', r.avg_all,
    'clarity', r.avg_clarity,
    'loyalty', r.avg_loyalty,
    'usefulness', r.avg_usefulness,
    'score', r.score,
    'rank', r.rank_overall,
    'recent', r.recent30,
    'last_review_at', r.last_review_at,
    'top_days', case when r.rank_overall between 1 and 10 then miniapp_teacher_reviews.streak('teachers', r.teacher_name) else 0 end,
    'mine', exists (select 1 from core.teacher_reviews x where x.organization_id = 'mirea' and x.user_id = p_user_id and x.teacher_name = r.teacher_name),
    'followed', exists (select 1 from miniapp_teacher_reviews.teacher_follows f where f.user_id = p_user_id and f.teacher_name = r.teacher_name),
    'my_group', exists (select 1 from miniapp_teacher_reviews.group_teachers(p_group, p_term) g where g.teacher_name = r.teacher_name),
    'disciplines', coalesce((
      select jsonb_agg(x.name order by x.c desc, x.name) from (
        select d.name, count(*) as c
        from core.schedule_teachers t
        join core.schedule_item_teacher it on it.teacher_id = t.id
        join core.schedule_item si on si.id = it.item_id
        join core.schedule_disciplines d on d.id = si.discipline_id
        where t.organization_id = 'mirea' and t.full_name = r.teacher_name and si.kind = 'lesson' and si.term_id = p_term
        group by d.name order by c desc, d.name limit 3
      ) x), '[]'::jsonb)
  );
$$;

create function miniapp_teacher_reviews.review_json(p_id uuid, p_user_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id,
    'teacher', r.teacher_name,
    'teacher_id', coalesce((select (array_agg(t.id order by t.id))[1] from core.schedule_teachers t where t.organization_id = 'mirea' and t.full_name = r.teacher_name), md5('mirea:' || r.teacher_name)::uuid),
    'clarity', r.clarity,
    'loyalty', r.loyalty,
    'usefulness', r.usefulness,
    'rating', round((r.clarity + r.loyalty + r.usefulness) / 3.0, 1),
    'body', r.body,
    'created_at', r.created_at,
    'author', miniapp_teacher_reviews.author_label(r.user_id, r.is_anonymous),
    'anonymous', r.is_anonymous,
    'mine', r.user_id = p_user_id,
    'helpful', (select count(*) from miniapp_teacher_reviews.review_votes v where v.review_id = r.id),
    'voted', exists (select 1 from miniapp_teacher_reviews.review_votes v where v.review_id = r.id and v.user_id = p_user_id)
  ) from core.teacher_reviews r where r.id = p_id;
$$;

create function miniapp_teacher_reviews.user_stats(p_user_id uuid, p_group uuid, p_term integer)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_reviews integer; v_helpful integer; v_texts integer; v_points integer; v_rank integer; v_show boolean;
  v_group_total integer; v_group_done integer; v_week integer; v_weeks integer; v_pioneer integer; v_streak integer;
  v_level integer; v_next integer; v_top boolean;
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
  select count(*) filter (where created_at >= miniapp_teacher_reviews.week_start()),
    count(distinct date_trunc('week', created_at at time zone 'Europe/Moscow'))
  into v_week, v_weeks
  from core.teacher_reviews where organization_id = 'mirea' and user_id = p_user_id;
  select count(*) into v_pioneer from (
    select (array_agg(user_id order by created_at, id))[1] as first_user
    from core.teacher_reviews where organization_id = 'mirea' group by teacher_name
  ) f where f.first_user = p_user_id;
  v_streak := miniapp_teacher_reviews.streak('students', p_user_id::text);
  v_top := v_rank is not null and v_rank <= 10;
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
    'group_name', (select academic_group from core.user_academic_profiles where user_id = p_user_id),
    'badges', jsonb_build_array(
      miniapp_teacher_reviews.badge('first', 'Первый отзыв', '🎉', 'Оставьте первый отзыв', v_reviews >= 1, v_reviews, 1),
      miniapp_teacher_reviews.badge('five', 'Пять преподов', '✋', 'Оцените пятерых преподавателей', v_reviews >= 5, v_reviews, 5),
      miniapp_teacher_reviews.badge('fifteen', 'Знаток кафедры', '🔥', 'Пятнадцать отзывов', v_reviews >= 15, v_reviews, 15),
      miniapp_teacher_reviews.badge('writer', 'Летописец', '✍️', 'Три отзыва с текстом от 60 символов', v_texts >= 3, v_texts, 3),
      miniapp_teacher_reviews.badge('group', 'Голос группы', '📣', 'Оцените троих преподавателей своей группы', v_group_done >= 3, v_group_done, 3),
      miniapp_teacher_reviews.badge('helpful', 'Полезный', '💡', 'Десять отметок «полезно» от других студентов', v_helpful >= 10, v_helpful, 10),
      miniapp_teacher_reviews.badge('pioneer', 'Первопроходец', '🚀', 'Первым оцените преподавателя', v_pioneer >= 1, v_pioneer, 1),
      miniapp_teacher_reviews.badge('waves', 'На волне', '🌊', 'Отзывы в трёх разных неделях', v_weeks >= 3, v_weeks, 3),
      miniapp_teacher_reviews.badge('top', 'В топе', '🏅', 'Войдите в топ-10 рецензентов', v_top, case when v_top then 1 else 0 end, 1)
    )
  );
end;
$$;

create function miniapp_teacher_reviews.board(p_user_id uuid, p_group uuid, p_term integer, p_board text, p_scope text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with base as (
    select t as tr from miniapp_teacher_reviews.teacher_table() t
    where (p_scope <> 'group' or exists (select 1 from miniapp_teacher_reviews.group_teachers(p_group, p_term) g where g.teacher_name = t.teacher_name))
      and case p_board when 'discussed' then t.reviews >= 1 when 'rising' then t.recent30 >= 1 else t.reviews >= 2 end
  ), ordered as (
    select tr, row_number() over (order by
      case p_board
        when 'clarity' then (tr).avg_clarity
        when 'loyalty' then (tr).avg_loyalty
        when 'usefulness' then (tr).avg_usefulness
        when 'discussed' then (tr).reviews
        when 'rising' then (tr).recent30
        else (tr).score end desc nulls last,
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

create function miniapp_teacher_reviews.students_board(p_user_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'rank', q.rn,
      'name', miniapp_teacher_reviews.display_name(q.user_id, coalesce(m.show_in_leaderboard, false)),
      'points', q.points,
      'reviews', q.reviews,
      'helpful', q.helpful,
      'mine', q.user_id = p_user_id,
      'streak', miniapp_teacher_reviews.streak('students', q.user_id::text)
    ) order by q.rn), '[]'::jsonb)
  from (
    select p.*, rank() over (order by p.points desc, p.reviews desc, p.user_id) as rn
    from miniapp_teacher_reviews.student_points() p where p.points > 0
  ) q left join miniapp_teacher_reviews.members m on m.user_id = q.user_id
  where q.rn <= 20;
$$;

create function miniapp_teacher_reviews.dispatch(p_user_id uuid, p_action text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v jsonb := coalesce(p_payload, '{}'::jsonb);
  v_group uuid; v_term integer; v_view text; v_name text; v_id uuid; v_me jsonb; v_teacher jsonb;
  v_q text; v_sort text; v_scope text; v_board text; v_offset integer; v_with_reviews boolean;
  v_review core.teacher_reviews%rowtype; v_first boolean; v_pioneer boolean; v_helpful boolean; v_count integer;
begin
  if p_user_id is null then raise exception 'User unavailable' using errcode = '42501'; end if;
  begin
    insert into miniapp_teacher_reviews.members(user_id) values (p_user_id)
    on conflict (user_id) do update set last_seen_at = now();
  exception when foreign_key_violation then
    raise exception 'User unavailable' using errcode = '42501';
  end;
  v_group := miniapp_teacher_reviews.user_group(p_user_id);
  v_term := miniapp_teacher_reviews.current_term();
  perform miniapp_teacher_reviews.ensure_snapshot();

  if p_action = 'state' then
    v_view := coalesce(v ->> 'view', 'home');
    v_me := miniapp_teacher_reviews.user_stats(p_user_id, v_group, v_term);
    if v_view in ('teacher', 'review') then
      v_id := nullif(v ->> 'id', '')::uuid;
      v_name := case when v_id is null then null else miniapp_teacher_reviews.resolve_teacher(v_id) end;
      if v_name is null then return jsonb_build_object('me', v_me, 'teacher', null); end if;
      select miniapp_teacher_reviews.teacher_card(t, p_user_id, v_group, v_term) || jsonb_build_object(
        'rank_clarity', t.rank_clarity,
        'rank_loyalty', t.rank_loyalty,
        'rank_usefulness', t.rank_usefulness,
        'rank_discussed', t.rank_discussed,
        'best_days', miniapp_teacher_reviews.best_streak('teachers', t.teacher_name),
        'eligible', (select count(*) from miniapp_teacher_reviews.teacher_table() e where e.rank_overall is not null),
        'groups', (select count(distinct ig.group_id)
          from core.schedule_teachers st join core.schedule_item_teacher it on it.teacher_id = st.id
          join core.schedule_item si on si.id = it.item_id join core.schedule_item_group ig on ig.item_id = si.id
          where st.organization_id = 'mirea' and st.full_name = t.teacher_name and si.term_id = v_term and si.kind = 'lesson'),
        'distribution', (select jsonb_build_array(
            count(*) filter (where s = 5), count(*) filter (where s = 4), count(*) filter (where s = 3),
            count(*) filter (where s = 2), count(*) filter (where s <= 1))
          from (select round((clarity + loyalty + usefulness) / 3.0) as s from core.teacher_reviews
            where organization_id = 'mirea' and teacher_name = t.teacher_name) d),
        'my_review', (select miniapp_teacher_reviews.review_json(r.id, p_user_id) from core.teacher_reviews r
          where r.organization_id = 'mirea' and r.teacher_name = t.teacher_name and r.user_id = p_user_id)
      ) into v_teacher
      from miniapp_teacher_reviews.teacher_table() t where t.teacher_name = v_name;
      if v_view = 'review' then return jsonb_build_object('me', v_me, 'teacher', v_teacher); end if;
      return jsonb_build_object('me', v_me, 'teacher', v_teacher || jsonb_build_object(
        'reviews_list', (select coalesce(jsonb_agg(miniapp_teacher_reviews.review_json(r.id, p_user_id)
            order by (select count(*) from miniapp_teacher_reviews.review_votes rv where rv.review_id = r.id) desc, r.created_at desc), '[]'::jsonb)
          from (select id, created_at from core.teacher_reviews where organization_id = 'mirea' and teacher_name = v_name order by created_at desc limit 100) r),
        'similar', (with td as (
            select distinct sa.discipline_id from core.schedule_teachers a
            join core.schedule_item_teacher ia on ia.teacher_id = a.id
            join core.schedule_item sa on sa.id = ia.item_id
            where a.organization_id = 'mirea' and a.full_name = v_name and sa.term_id = v_term and sa.discipline_id is not null
          ), peers as (
            select distinct b.full_name from td
            join core.schedule_item sb on sb.discipline_id = td.discipline_id
            join core.schedule_item_teacher ib on ib.item_id = sb.id
            join core.schedule_teachers b on b.id = ib.teacher_id
            where sb.term_id = v_term and b.full_name <> v_name
          )
          select coalesce(jsonb_agg(miniapp_teacher_reviews.teacher_card(s, p_user_id, v_group, v_term) order by s.score desc nulls last, s.teacher_name), '[]'::jsonb)
          from (select s.* from peers p join miniapp_teacher_reviews.teacher_table() s on s.teacher_name = p.full_name
            where s.reviews >= 1 order by s.score desc nulls last, s.teacher_name limit 4) s)
      ));
    end if;
    if v_view = 'top' then
      return jsonb_build_object('me', v_me,
        'board', miniapp_teacher_reviews.board(p_user_id, v_group, v_term, 'overall', 'all'),
        'students', miniapp_teacher_reviews.students_board(p_user_id));
    end if;
    if v_view = 'me' then
      return jsonb_build_object('me', v_me,
        'my_reviews', (select coalesce(jsonb_agg(miniapp_teacher_reviews.review_json(r.id, p_user_id)
            || jsonb_build_object('card', miniapp_teacher_reviews.teacher_card(t, p_user_id, v_group, v_term)) order by r.created_at desc), '[]'::jsonb)
          from core.teacher_reviews r join miniapp_teacher_reviews.teacher_table() t on t.teacher_name = r.teacher_name
          where r.organization_id = 'mirea' and r.user_id = p_user_id),
        'followed', (select coalesce(jsonb_agg(miniapp_teacher_reviews.teacher_card(t, p_user_id, v_group, v_term) order by f.created_at desc), '[]'::jsonb)
          from miniapp_teacher_reviews.teacher_follows f join miniapp_teacher_reviews.teacher_table() t on t.teacher_name = f.teacher_name
          where f.user_id = p_user_id));
    end if;
    if v_view = 'recommend' then
      return jsonb_build_object('me', v_me,
        'recommend', (select coalesce(jsonb_agg(miniapp_teacher_reviews.teacher_card(t, p_user_id, v_group, v_term)
            || jsonb_build_object('occurrences', g.occurrences, 'today', g.today, 'time', g.first_time, 'subject', g.subject)
            order by g.today desc, (t.reviews = 0) desc, g.occurrences desc, t.teacher_name), '[]'::jsonb)
          from miniapp_teacher_reviews.group_teachers(v_group, v_term) g
          join miniapp_teacher_reviews.teacher_table() t on t.teacher_name = g.teacher_name
          where not exists (select 1 from core.teacher_reviews r where r.organization_id = 'mirea' and r.user_id = p_user_id and r.teacher_name = g.teacher_name)),
        'reviewed', (select coalesce(jsonb_agg(miniapp_teacher_reviews.teacher_card(t, p_user_id, v_group, v_term) order by t.teacher_name), '[]'::jsonb)
          from miniapp_teacher_reviews.group_teachers(v_group, v_term) g
          join miniapp_teacher_reviews.teacher_table() t on t.teacher_name = g.teacher_name
          where exists (select 1 from core.teacher_reviews r where r.organization_id = 'mirea' and r.user_id = p_user_id and r.teacher_name = g.teacher_name)));
    end if;
    return jsonb_build_object('me', v_me,
      'today', (select coalesce(jsonb_agg(miniapp_teacher_reviews.teacher_card(t, p_user_id, v_group, v_term)
          || jsonb_build_object('time', g.first_time, 'subject', g.subject) order by g.first_time, t.teacher_name), '[]'::jsonb)
        from miniapp_teacher_reviews.group_teachers(v_group, v_term) g
        join miniapp_teacher_reviews.teacher_table() t on t.teacher_name = g.teacher_name where g.today),
      'recommend', (select coalesce(jsonb_agg(x.card), '[]'::jsonb) from (
        select miniapp_teacher_reviews.teacher_card(t, p_user_id, v_group, v_term)
          || jsonb_build_object('occurrences', g.occurrences, 'today', g.today) as card
        from miniapp_teacher_reviews.group_teachers(v_group, v_term) g
        join miniapp_teacher_reviews.teacher_table() t on t.teacher_name = g.teacher_name
        where not exists (select 1 from core.teacher_reviews r where r.organization_id = 'mirea' and r.user_id = p_user_id and r.teacher_name = g.teacher_name)
        order by g.today desc, (t.reviews = 0) desc, g.occurrences desc, t.teacher_name limit 6) x),
      'top', (select coalesce(jsonb_agg(miniapp_teacher_reviews.teacher_card(t, p_user_id, v_group, v_term) order by t.rank_overall), '[]'::jsonb)
        from miniapp_teacher_reviews.teacher_table() t where t.rank_overall between 1 and 5),
      'recent', (select coalesce(jsonb_agg(miniapp_teacher_reviews.review_json(r.id, p_user_id) order by r.created_at desc), '[]'::jsonb)
        from (select id, created_at from core.teacher_reviews where organization_id = 'mirea' order by created_at desc limit 6) r),
      'stats', jsonb_build_object(
        'teachers', (select count(distinct teacher_name) from core.teacher_reviews where organization_id = 'mirea'),
        'reviews', (select count(*) from core.teacher_reviews where organization_id = 'mirea'),
        'week', (select count(*) from core.teacher_reviews where organization_id = 'mirea' and created_at >= miniapp_teacher_reviews.week_start()),
        'reviewers', (select count(distinct user_id) from core.teacher_reviews where organization_id = 'mirea')));
  end if;

  if p_action = 'search' then
    v_q := replace(replace(replace(left(btrim(coalesce(v ->> 'q', '')), 100), '\', '\\'), '%', '\%'), '_', '\_');
    v_sort := coalesce(v ->> 'sort', 'rating');
    v_scope := coalesce(v ->> 'scope', 'all');
    v_with_reviews := coalesce((v ->> 'with_reviews')::boolean, false);
    v_offset := greatest(0, least(coalesce((v ->> 'offset')::integer, 0), 100000));
    return (with dm as (
      select distinct it.teacher_id from core.schedule_disciplines d
      join core.schedule_item si on si.discipline_id = d.id
      join core.schedule_item_teacher it on it.item_id = si.id
      where d.organization_id = 'mirea' and v_q <> '' and si.term_id = v_term and d.name ilike '%' || v_q || '%'
    ), filtered as (
      select t as tr from miniapp_teacher_reviews.teacher_table() t
      where (v_q = '' or t.teacher_name ilike '%' || v_q || '%'
          or exists (select 1 from core.schedule_teachers x join dm on dm.teacher_id = x.id where x.full_name = t.teacher_name))
        and (v_scope <> 'group' or exists (select 1 from miniapp_teacher_reviews.group_teachers(v_group, v_term) g where g.teacher_name = t.teacher_name))
        and (v_scope <> 'followed' or exists (select 1 from miniapp_teacher_reviews.teacher_follows f where f.user_id = p_user_id and f.teacher_name = t.teacher_name))
        and (v_scope <> 'reviewed' or exists (select 1 from core.teacher_reviews r where r.organization_id = 'mirea' and r.user_id = p_user_id and r.teacher_name = t.teacher_name))
        and (not v_with_reviews or t.reviews >= 1)
    ), page as (
      select tr from filtered
      order by
        case v_sort
          when 'rating' then (tr).score
          when 'reviews' then (tr).reviews
          when 'new' then extract(epoch from (tr).last_review_at)
          when 'clarity' then (tr).avg_clarity
          when 'loyalty' then (tr).avg_loyalty
          when 'usefulness' then (tr).avg_usefulness
          else null end desc nulls last,
        (v_q <> '' and (tr).teacher_name ilike v_q || '%') desc,
        case when v_sort = 'name' then 0 else (tr).reviews end desc,
        (tr).teacher_name
      limit 20 offset v_offset
    )
    select jsonb_build_object(
      'count', (select count(*) from filtered),
      'offset', v_offset,
      'items', coalesce((select jsonb_agg(miniapp_teacher_reviews.teacher_card(p.tr, p_user_id, v_group, v_term)) from page p), '[]'::jsonb)));
  end if;

  if p_action = 'top' then
    v_board := coalesce(v ->> 'board', 'overall');
    v_scope := coalesce(v ->> 'scope', 'all');
    if v_board not in ('overall', 'clarity', 'loyalty', 'usefulness', 'discussed', 'rising') or v_scope not in ('all', 'group') then
      raise exception 'Unknown board' using errcode = '22023';
    end if;
    return miniapp_teacher_reviews.board(p_user_id, v_group, v_term, v_board, v_scope);
  end if;

  if p_action in ('review', 'delete_review', 'follow') then
    v_id := nullif(v ->> 'id', '')::uuid;
    v_name := case when v_id is null then null else miniapp_teacher_reviews.resolve_teacher(v_id) end;
    if v_name is null then raise exception 'Teacher missing' using errcode = 'P0002'; end if;
  end if;

  if p_action = 'review' then
    if (v ->> 'clarity')::integer not between 1 and 5 or (v ->> 'loyalty')::integer not between 1 and 5 or (v ->> 'usefulness')::integer not between 1 and 5 then
      raise exception 'Invalid rating' using errcode = '22023';
    end if;
    if char_length(coalesce(v ->> 'body', '')) > 2000 or coalesce(v ->> 'body', '') ~ '\{\{|\}\}' then
      raise exception 'Invalid body' using errcode = '22023';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text || ':teacher-reviews:review', 0));
    select * into v_review from core.teacher_reviews r where r.organization_id = 'mirea' and r.user_id = p_user_id and r.teacher_name = v_name;
    v_first := not found;
    if v_first or (v_review.clarity, v_review.loyalty, v_review.usefulness, v_review.body, v_review.is_anonymous) is distinct from
      ((v ->> 'clarity')::integer, (v ->> 'loyalty')::integer, (v ->> 'usefulness')::integer, btrim(coalesce(v ->> 'body', '')), coalesce((v ->> 'anonymous')::boolean, false)) then
      perform miniapp_teacher_reviews.consume(p_user_id, 'review', 20);
    end if;
    v_pioneer := v_first and not exists (select 1 from core.teacher_reviews r where r.organization_id = 'mirea' and r.teacher_name = v_name);
    insert into core.teacher_reviews (organization_id, user_id, teacher_name, clarity, loyalty, usefulness, body, is_anonymous)
    values ('mirea', p_user_id, v_name, (v ->> 'clarity')::integer, (v ->> 'loyalty')::integer, (v ->> 'usefulness')::integer,
      btrim(coalesce(v ->> 'body', '')), coalesce((v ->> 'anonymous')::boolean, false))
    on conflict (user_id, teacher_name) do update set
      clarity = excluded.clarity, loyalty = excluded.loyalty, usefulness = excluded.usefulness,
      body = excluded.body, is_anonymous = excluded.is_anonymous;
    return jsonb_build_object('ok', true, 'first', v_first, 'pioneer', v_pioneer,
      'points', (select coalesce(points, 0) from miniapp_teacher_reviews.student_points() where user_id = p_user_id));
  end if;

  if p_action = 'delete_review' then
    delete from core.teacher_reviews r where r.organization_id = 'mirea' and r.user_id = p_user_id and r.teacher_name = v_name;
    get diagnostics v_count = row_count;
    if v_count = 0 then raise exception 'Review missing' using errcode = 'P0002'; end if;
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'follow' then
    if jsonb_typeof(v -> 'follow') is distinct from 'boolean' then raise exception 'Invalid follow value' using errcode = '22023'; end if;
    if (v ->> 'follow')::boolean then
      if not exists (select 1 from miniapp_teacher_reviews.teacher_follows f where f.user_id = p_user_id and f.teacher_name = v_name) then
        perform miniapp_teacher_reviews.consume(p_user_id, 'follow', 200);
        insert into miniapp_teacher_reviews.teacher_follows(user_id, teacher_name) values (p_user_id, v_name) on conflict do nothing;
      end if;
    else
      delete from miniapp_teacher_reviews.teacher_follows f where f.user_id = p_user_id and f.teacher_name = v_name;
    end if;
    return jsonb_build_object('ok', true, 'followed', (v ->> 'follow')::boolean);
  end if;

  if p_action = 'vote' then
    v_id := nullif(v ->> 'id', '')::uuid;
    if jsonb_typeof(v -> 'helpful') is distinct from 'boolean' then raise exception 'Invalid vote' using errcode = '22023'; end if;
    v_helpful := (v ->> 'helpful')::boolean;
    select * into v_review from core.teacher_reviews r where r.id = v_id and r.organization_id = 'mirea';
    if not found then raise exception 'Review missing' using errcode = 'P0002'; end if;
    if v_review.user_id = p_user_id then raise exception 'Own review' using errcode = '22023'; end if;
    if v_helpful then
      if not exists (select 1 from miniapp_teacher_reviews.review_votes rv where rv.user_id = p_user_id and rv.review_id = v_id) then
        perform miniapp_teacher_reviews.consume(p_user_id, 'vote', 100);
        insert into miniapp_teacher_reviews.review_votes(user_id, review_id) values (p_user_id, v_id) on conflict do nothing;
      end if;
    else
      delete from miniapp_teacher_reviews.review_votes rv where rv.user_id = p_user_id and rv.review_id = v_id;
    end if;
    return jsonb_build_object('ok', true, 'helpful', (select count(*) from miniapp_teacher_reviews.review_votes rv where rv.review_id = v_id));
  end if;

  if p_action = 'settings' then
    if jsonb_typeof(v -> 'show_in_leaderboard') is distinct from 'boolean' then raise exception 'Invalid setting' using errcode = '22023'; end if;
    update miniapp_teacher_reviews.members set show_in_leaderboard = (v ->> 'show_in_leaderboard')::boolean where user_id = p_user_id;
    return jsonb_build_object('ok', true);
  end if;

  raise exception 'Action not found' using errcode = '22023';
end;
$$;

create function public.miniapp_teacher_reviews_dispatch(p_user_id uuid, p_action text, p_payload jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select miniapp_teacher_reviews.dispatch(p_user_id, p_action, p_payload);
$$;

revoke all on all functions in schema miniapp_teacher_reviews from public, anon, authenticated;
grant execute on all functions in schema miniapp_teacher_reviews to service_role;
revoke all on function public.miniapp_teacher_reviews_dispatch(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.miniapp_teacher_reviews_dispatch(uuid, text, jsonb) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('teacher-reviews-daily-top', '5 21 * * *', 'select miniapp_teacher_reviews.ensure_snapshot()');
  end if;
end;
$$;

insert into core.mini_apps (organization_id, owner_id, slug, name, description, icon_emoji, accent_color, category, tags, requested_permissions, source_kind, status, published_at)
select 'mirea', null, 'teacher-reviews', 'Отзывы о преподах',
  'Честные оценки преподавателей: поиск, фильтры, рейтинги по понятности, лояльности и пользе. Топы, серии дней в топе, значки и рекомендации, кого оценить первым.',
  '🎓', '#D97706', 'study', array['преподаватели', 'отзывы', 'рейтинг', 'топ', 'оценки'], array[]::text[], 'service', 'published', now()
where exists (select 1 from core.organizations where id = 'mirea')
on conflict (organization_id, slug) do update set
  name = excluded.name, description = excluded.description, icon_emoji = excluded.icon_emoji,
  accent_color = excluded.accent_color, category = excluded.category, tags = excluded.tags,
  requested_permissions = excluded.requested_permissions, source_kind = excluded.source_kind,
  status = 'published', published_at = coalesce(core.mini_apps.published_at, now()), updated_at = now();

commit;
