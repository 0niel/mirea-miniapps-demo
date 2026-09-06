begin;

create schema if not exists miniapp_student_discounts;
revoke all on schema miniapp_student_discounts from public, anon, authenticated;
grant usage on schema miniapp_student_discounts to service_role;

create function miniapp_student_discounts.valid_content(v jsonb)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare k text; u text;
begin
  if v is null or jsonb_typeof(v) <> 'object' or octet_length(v::text) > 12000 or v::text ~ '\{\{|\}\}' then return false; end if;
  foreach k in array array['title','provider','benefit','description','eligibility','geography','validity_note'] loop
    if jsonb_typeof(v->k) is distinct from 'string' or char_length(trim(v->>k)) not between 2 and 1200 then return false; end if;
  end loop;
  if v->>'category' is null or v->>'category' not in ('software','design','learning','culture','transport','food','shopping','sport') then return false; end if;
  if v->>'region' is null or v->>'region' not in ('moscow','russia','international','saint-petersburg') then return false; end if;
  if jsonb_typeof(v->'online') is distinct from 'boolean' then return false; end if;
  foreach k in array array['source_url','redeem_url','restriction_url'] loop
    u := v->>k;
    if k='restriction_url' and u is null then continue; end if;
    if u is null or char_length(u) > 1500 or u !~ '^https://[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}([/?#][^[:space:]{}\\]*)?$' or u ~ '^https://[^/]*(\.local|\.internal|\.localhost)([/?#]|$)' then return false; end if;
  end loop;
  if jsonb_typeof(v->'steps') is distinct from 'array' then return false; end if;
  if jsonb_array_length(v->'steps') not between 1 and 8 then return false; end if;
  if exists(select 1 from jsonb_array_elements(v->'steps') e where jsonb_typeof(e) <> 'string' or char_length(e#>>'{}') not between 1 and 800) then return false; end if;
  if coalesce(char_length(v->>'coupon'),0) > 80 then return false; end if;
  if v->>'valid_until' is not null then
    if v->>'valid_until' !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
    perform (v->>'valid_until')::date;
  end if;
  return true;
exception when others then return false;
end;
$$;

create table miniapp_student_discounts.members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table miniapp_student_discounts.catalog_state (
  singleton boolean primary key default true check(singleton),
  generated_at timestamptz not null
);
create table miniapp_student_discounts.offers (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{2,79}$'),
  content jsonb not null check (miniapp_student_discounts.valid_content(content)),
  origin text not null check (origin in ('curated','community')),
  status text not null default 'active' check(status in ('active','paused')),
  source_status text not null check(source_status in ('checked','changed','unavailable')),
  verified_at timestamptz,
  checked_at timestamptz not null,
  check(source_status <> 'checked' or verified_at is not null),
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table miniapp_student_discounts.favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  offer_id text not null references miniapp_student_discounts.offers(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user_id,offer_id)
);
create table miniapp_student_discounts.suggestions (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content jsonb not null check(miniapp_student_discounts.valid_content(content)),
  status text not null default 'pending' check(status in ('pending','approved','rejected','withdrawn')),
  moderation_note text check(char_length(moderation_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index student_discount_suggestions_owner on miniapp_student_discounts.suggestions(user_id,updated_at desc);
create index student_discount_suggestions_queue on miniapp_student_discounts.suggestions(updated_at) where status='pending';
create table miniapp_student_discounts.reports (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  offer_id text not null references miniapp_student_discounts.offers(id) on delete cascade,
  reason text not null check(reason in ('expired','rejected','conditions','link','other')),
  details text not null default '' check(char_length(details) <= 800 and details !~ '\{\{|\}\}'),
  status text not null default 'pending' check(status in ('pending','resolved')),
  created_at timestamptz not null default now(),
  unique(user_id,offer_id)
);
create index student_discount_reports_queue on miniapp_student_discounts.reports(created_at) where status='pending';
create table miniapp_student_discounts.daily_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  action text not null check(action in ('suggest','report')),
  uses integer not null check(uses > 0),
  primary key(user_id,usage_date,action)
);
create table miniapp_student_discounts.moderation_log (
  id bigint generated always as identity primary key,
  moderator_id uuid references auth.users(id) on delete set null,
  target_id uuid not null,
  decision text not null,
  note text not null check(char_length(note) between 3 and 500 and note !~ '\{\{|\}\}'),
  created_at timestamptz not null default now()
);
alter table miniapp_student_discounts.members enable row level security;
alter table miniapp_student_discounts.catalog_state enable row level security;
alter table miniapp_student_discounts.offers enable row level security;
alter table miniapp_student_discounts.favorites enable row level security;
alter table miniapp_student_discounts.suggestions enable row level security;
alter table miniapp_student_discounts.reports enable row level security;
alter table miniapp_student_discounts.daily_usage enable row level security;
alter table miniapp_student_discounts.moderation_log enable row level security;
revoke all on all tables in schema miniapp_student_discounts from public, anon, authenticated;
grant all on all tables in schema miniapp_student_discounts to service_role;
grant usage,select on all sequences in schema miniapp_student_discounts to service_role;

create function miniapp_student_discounts.is_moderator(p_user_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists(select 1 from core.mini_app_moderators m where m.organization_id='mirea' and m.user_id=p_user_id);
$$;

create function miniapp_student_discounts.consume(p_user_id uuid,p_action text,p_limit integer)
returns void language plpgsql security invoker set search_path = '' as $$
declare used integer;
begin
  insert into miniapp_student_discounts.daily_usage(user_id,usage_date,action,uses)
  values(p_user_id,(now() at time zone 'Europe/Moscow')::date,p_action,1)
  on conflict(user_id,usage_date,action) do update set uses=miniapp_student_discounts.daily_usage.uses+1
  where miniapp_student_discounts.daily_usage.uses < p_limit
  returning uses into used;
  if used is null then raise exception 'Daily limit reached' using errcode='P0001'; end if;
end;
$$;

create function miniapp_student_discounts.dispatch(p_user_id uuid,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v jsonb := coalesce(p_payload,'{}'::jsonb);
  is_mod boolean;
  suggestion miniapp_student_discounts.suggestions%rowtype;
  report miniapp_student_discounts.reports%rowtype;
  target uuid;
  v_offer_id text;
  decision text;
  note text;
  listing jsonb;
begin
  if p_user_id is null then
    raise exception 'User unavailable' using errcode='42501';
  end if;
  begin
    insert into miniapp_student_discounts.members(user_id) values(p_user_id) on conflict do nothing;
  exception when foreign_key_violation then
    raise exception 'User unavailable' using errcode='42501';
  end;
  is_mod := miniapp_student_discounts.is_moderator(p_user_id);
  if p_action='state' then
    with filtered as (
      select o.*, f.user_id is not null as saved
      from miniapp_student_discounts.offers o
      left join miniapp_student_discounts.favorites f on f.offer_id=o.id and f.user_id=p_user_id
      where ((o.status='active' and o.retired_at is null) or f.user_id is not null or is_mod)
        and (case when coalesce(v->>'id','')<>'' then o.id=v->>'id' else
          (coalesce(v->>'saved','false')<>'true' or f.user_id is not null)
          and (coalesce(v->>'show_expired','false')='true' or (o.status='active' and o.retired_at is null and (o.content->>'valid_until' is null or (o.content->>'valid_until')::date >= (now() at time zone 'Europe/Moscow')::date)))
          and (coalesce(v->>'q','')='' or strpos(lower(concat_ws(' ',o.content->>'title',o.content->>'provider',o.content->>'description',o.content->>'benefit')),lower(left(trim(v->>'q'),100)))>0)
          and (coalesce(v->>'category','all') in ('','all') or o.content->>'category'=v->>'category')
          and (coalesce(v->>'region','all') in ('','all') or o.content->>'region'=v->>'region')
          and (coalesce(v->>'online','false')<>'true' or o.content->>'online'='true')
          and (coalesce(v->>'free','false')<>'true' or o.content->>'benefit' ilike '%бесплат%')
        end)
    ), page as (
      select * from filtered
      order by case content->>'region' when 'moscow' then 0 when 'russia' then 1 when 'saint-petersburg' then 2 else 3 end,content->>'title',id
      limit 24 offset greatest(0,least(coalesce((v->>'offset')::integer,0),100000))
    )
    select jsonb_build_object('count',(select count(*) from filtered),'items',coalesce((select jsonb_agg(p.content||jsonb_build_object('id',p.id,'status',case when p.retired_at is not null then 'paused' else p.status end,'source_status',p.source_status,'verified_at',p.verified_at,'checked_at',p.checked_at,'saved',p.saved)) from page p),'[]'::jsonb)) into listing;
    return jsonb_build_object(
      'isModerator',is_mod,
      'offers',listing->'items','total',listing->'count',
      'offerCount',(select count(*) from miniapp_student_discounts.offers where status='active' and retired_at is null),
      'savedCount',(select count(*) from miniapp_student_discounts.favorites where user_id=p_user_id),
      'suggestions',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'content',s.content,'status',s.status,'moderation_note',s.moderation_note,'updated_at',s.updated_at) order by s.updated_at desc) from (select * from miniapp_student_discounts.suggestions where user_id=p_user_id and (coalesce(v->>'id','')='' or id::text=v->>'id') order by updated_at desc limit 100) s),'[]'::jsonb)
    );
  end if;
  if p_action='favorite' then
    v_offer_id:=v->>'id';
    if jsonb_typeof(v->'saved') is distinct from 'boolean' then raise exception 'Invalid saved value' using errcode='22023'; end if;
    if not exists(select 1 from miniapp_student_discounts.offers o where o.id=v_offer_id and ((o.status='active' and o.retired_at is null) or exists(select 1 from miniapp_student_discounts.favorites f where f.offer_id=o.id and f.user_id=p_user_id))) then raise exception 'Offer missing' using errcode='P0002'; end if;
    if (v->>'saved')::boolean then
      insert into miniapp_student_discounts.favorites(user_id,offer_id) values(p_user_id,v_offer_id) on conflict do nothing;
    else
      delete from miniapp_student_discounts.favorites f where f.user_id=p_user_id and f.offer_id=v_offer_id;
    end if;
    return jsonb_build_object('ok',true);
  end if;
  if p_action='suggest' then
    if not miniapp_student_discounts.valid_content(v->'content') then raise exception 'Invalid offer' using errcode='22023'; end if;
    if v->>'id' is not null then
      select * into suggestion from miniapp_student_discounts.suggestions s where s.id=(v->>'id')::uuid and s.user_id=p_user_id for update;
      if not found or suggestion.status='approved' then raise exception 'Suggestion unavailable' using errcode='P0002'; end if;
      if suggestion.status='pending' and suggestion.content=v->'content' then return jsonb_build_object('id',suggestion.id); end if;
    else
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text || ':student-discounts:suggest',0));
      select * into suggestion from miniapp_student_discounts.suggestions s where s.user_id=p_user_id and s.status='pending' and s.content=v->'content' limit 1;
      if found then return jsonb_build_object('id',suggestion.id); end if;
    end if;
    perform miniapp_student_discounts.consume(p_user_id,'suggest',5);
    if v->>'id' is null then
      insert into miniapp_student_discounts.suggestions(user_id,content) values(p_user_id,v->'content') returning id into target;
    else
      update miniapp_student_discounts.suggestions s set content=v->'content',status='pending',moderation_note=null,updated_at=clock_timestamp() where s.id=suggestion.id returning id into target;
    end if;
    return jsonb_build_object('id',target);
  end if;
  if p_action='withdraw' then
    update miniapp_student_discounts.suggestions s set status='withdrawn',updated_at=now() where s.id=(v->>'id')::uuid and s.user_id=p_user_id and s.status='pending' returning id into target;
    if target is null then raise exception 'Suggestion unavailable' using errcode='P0002'; end if;
    return jsonb_build_object('ok',true);
  end if;
  if p_action='report' then
    v_offer_id:=v->>'id';
    if not exists(select 1 from miniapp_student_discounts.offers o where o.id=v_offer_id and o.status='active' and o.retired_at is null) then raise exception 'Offer unavailable' using errcode='P0002'; end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text || ':student-discounts:report',0));
    if exists(select 1 from miniapp_student_discounts.reports r where r.user_id=p_user_id and r.offer_id=v_offer_id) then return jsonb_build_object('ok',true); end if;
    perform miniapp_student_discounts.consume(p_user_id,'report',10);
    insert into miniapp_student_discounts.reports(user_id,offer_id,reason,details) values(p_user_id,v_offer_id,v->>'reason',coalesce(v->>'details',''));
    return jsonb_build_object('ok',true);
  end if;
  if p_action in ('moderation_queue','moderate') and not is_mod then raise exception 'Moderator required' using errcode='42501'; end if;
  if p_action='moderation_queue' then
    return jsonb_build_object(
      'suggestions',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'content',s.content,'created_at',s.created_at,'updated_at',s.updated_at) order by s.created_at) from (select * from miniapp_student_discounts.suggestions where status='pending' order by created_at limit 100) s),'[]'::jsonb),
      'reports',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'offer_id',r.offer_id,'offer_title',o.content->>'title','reason',r.reason,'details',r.details,'created_at',r.created_at) order by r.created_at) from (select * from miniapp_student_discounts.reports where status='pending' order by created_at limit 100) r join miniapp_student_discounts.offers o on o.id=r.offer_id),'[]'::jsonb)
    );
  end if;
  if p_action='moderate' then
    target:=(v->>'id')::uuid; decision:=v->>'decision'; note:=trim(v->>'note');
    if note is null or char_length(note) not between 3 and 500 or note ~ '\{\{|\}\}' then raise exception 'Moderation note required' using errcode='22023'; end if;
    if decision in ('approve','reject') then
      select * into suggestion from miniapp_student_discounts.suggestions s where s.id=target and s.status='pending' for update;
      if not found then raise exception 'Suggestion already handled' using errcode='P0002'; end if;
      if v->>'expected_updated_at' is null or (v->>'expected_updated_at')::timestamptz is distinct from suggestion.updated_at then raise exception 'Suggestion changed since review' using errcode='40001'; end if;
      if decision='approve' then
        if suggestion.content->>'valid_until' is not null and (suggestion.content->>'valid_until')::date < (now() at time zone 'Europe/Moscow')::date then raise exception 'Offer expired' using errcode='22023'; end if;
        insert into miniapp_student_discounts.offers(id,content,origin,source_status,verified_at,checked_at) values('community-'||suggestion.id::text,suggestion.content,'community','checked',now(),now());
      end if;
      update miniapp_student_discounts.suggestions set status=case when decision='approve' then 'approved' else 'rejected' end,moderation_note=note,updated_at=now() where id=target;
    elsif decision in ('dismiss_report','pause_offer') then
      select * into report from miniapp_student_discounts.reports r where r.id=target and r.status='pending' for update;
      if not found then raise exception 'Report already handled' using errcode='P0002'; end if;
      if decision='pause_offer' then update miniapp_student_discounts.offers set status='paused',updated_at=now() where id=report.offer_id; end if;
      update miniapp_student_discounts.reports set status='resolved' where id=target;
    else raise exception 'Invalid moderation decision' using errcode='22023'; end if;
    insert into miniapp_student_discounts.moderation_log(moderator_id,target_id,decision,note) values(p_user_id,target,decision,note);
    return jsonb_build_object('ok',true);
  end if;
  raise exception 'Action not found' using errcode='22023';
end;
$$;

create function public.miniapp_student_discounts_dispatch(p_user_id uuid,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select miniapp_student_discounts.dispatch(p_user_id,p_action,p_payload);
$$;

create function public.student_discounts_import(p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v jsonb; ids text[] := '{}'; checked timestamptz; verified timestamptz; generated timestamptz; imported integer := 0; retired integer := 0;
begin
  if p_payload->>'schema_version' is distinct from '1' or jsonb_typeof(p_payload->'offers') is distinct from 'array' then raise exception 'Invalid catalog' using errcode='22023'; end if;
  if jsonb_array_length(p_payload->'offers') not between 1 and 500 or octet_length(p_payload::text)>2000000 then raise exception 'Invalid catalog size' using errcode='22023'; end if;
  generated:=(p_payload->>'generated_at')::timestamptz;
  if generated is null or generated>now()+interval '5 minutes' then raise exception 'Invalid catalog date' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('student-discounts:catalog-import',0));
  if generated < greatest(coalesce((select max(checked_at) from miniapp_student_discounts.offers where origin='curated'),'-infinity'::timestamptz),coalesce((select generated_at from miniapp_student_discounts.catalog_state where singleton),'-infinity'::timestamptz)) then return jsonb_build_object('imported',0,'retired',0,'skipped',true); end if;
  for v in select value from jsonb_array_elements(p_payload->'offers') loop
    if not miniapp_student_discounts.valid_content(v) or v->>'id' is null or v->>'id' !~ '^[a-z0-9][a-z0-9-]{2,79}$' or v->>'id' like 'community-%' or v->>'id'=any(ids) then raise exception 'Invalid offer' using errcode='22023'; end if;
    checked:=(v->>'checked_at')::timestamptz; verified:=(v->>'verified_at')::timestamptz;
    if checked is null or checked > generated or verified>checked or v->>'source_status' is null or v->>'source_status' not in ('checked','changed','unavailable') then raise exception 'Invalid evidence date' using errcode='22023'; end if;
    if v->>'source_status'='checked' and (verified is null or v->>'source_sha256' is null or v->>'source_sha256' !~ '^[a-f0-9]{64}$') then raise exception 'Missing source evidence' using errcode='22023'; end if;
    ids:=array_append(ids,v->>'id');
    insert into miniapp_student_discounts.offers(id,content,origin,source_status,verified_at,checked_at)
    values(v->>'id',v-'id'-'status'-'saved'-'origin','curated',v->>'source_status',verified,checked)
    on conflict(id) do update set
      content=case when excluded.source_status='checked' or miniapp_student_discounts.offers.verified_at is null then excluded.content else miniapp_student_discounts.offers.content end,
      source_status=excluded.source_status,
      verified_at=case when excluded.source_status='checked' then excluded.verified_at else coalesce(miniapp_student_discounts.offers.verified_at,excluded.verified_at) end,
      checked_at=excluded.checked_at,retired_at=null,updated_at=now()
    where miniapp_student_discounts.offers.origin='curated' and excluded.checked_at>=miniapp_student_discounts.offers.checked_at and (excluded.source_status<>'checked' or excluded.verified_at>=coalesce(miniapp_student_discounts.offers.verified_at,'-infinity'::timestamptz));
    imported:=imported+1;
  end loop;
  update miniapp_student_discounts.offers set retired_at=generated,updated_at=now() where origin='curated' and retired_at is null and not (id=any(ids));
  get diagnostics retired=row_count;
  insert into miniapp_student_discounts.catalog_state(singleton,generated_at) values(true,generated) on conflict(singleton) do update set generated_at=excluded.generated_at;
  return jsonb_build_object('imported',imported,'retired',retired,'skipped',false);
end;
$$;

revoke all on all functions in schema miniapp_student_discounts from public,anon,authenticated;
grant execute on all functions in schema miniapp_student_discounts to service_role;
revoke all on function public.miniapp_student_discounts_dispatch(uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.student_discounts_import(jsonb) from public,anon,authenticated;
grant execute on function public.miniapp_student_discounts_dispatch(uuid,text,jsonb) to service_role;
grant execute on function public.student_discounts_import(jsonb) to service_role;

insert into core.mini_apps(organization_id,owner_id,slug,name,description,icon_emoji,accent_color,category,tags,requested_permissions,source_kind,status,published_at)
select 'mirea',null,'student-discounts','Скидки студентам','Проверяемые предложения, студенческие льготы и находки сообщества. Условия, избранное и напоминания в одном месте.','🎟️','#188B66','campus',array['скидки','льготы','студенты','бесплатно'],array[]::text[],'service','published',now()
where exists(select 1 from core.organizations where id='mirea')
on conflict(organization_id,slug) do update set name=excluded.name,description=excluded.description,icon_emoji=excluded.icon_emoji,accent_color=excluded.accent_color,category=excluded.category,tags=excluded.tags,requested_permissions=excluded.requested_permissions,source_kind=excluded.source_kind,status='published',published_at=coalesce(core.mini_apps.published_at,now()),updated_at=now();

commit;
