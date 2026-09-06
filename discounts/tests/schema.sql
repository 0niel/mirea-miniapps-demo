begin;

create temporary table student_discount_fixture as select extensions.gen_random_uuid() as actor, extensions.gen_random_uuid() as other_user, extensions.gen_random_uuid() as moderator;
insert into auth.users(id) select actor from student_discount_fixture union all select other_user from student_discount_fixture union all select moderator from student_discount_fixture;
insert into core.mini_app_moderators(organization_id,user_id) select 'mirea',moderator from student_discount_fixture;
grant select on student_discount_fixture to service_role;
set local role service_role;

do $$
declare
  actor uuid := (select f.actor from student_discount_fixture f);
  other_user uuid := (select f.other_user from student_discount_fixture f);
  moderator uuid := (select f.moderator from student_discount_fixture f);
  suggestion_id uuid;
  reviewed_version timestamptz;
  report_id uuid;
  community_id text;
  result jsonb;
  value jsonb := jsonb_build_object('title','Тестовая скидка','provider','Тестовый музей','benefit','Скидка 20%','description','Учебное предложение для проверки','eligibility','По действующему студенческому билету','geography','Москва','validity_note','Дата окончания не указана','category','culture','region','moscow','online',false,'source_url','https://museum.example.org/terms','redeem_url','https://museum.example.org/tickets','steps',jsonb_build_array('Предъявите документ'),'coupon','','valid_until',null);
  forbidden boolean;
begin
  if has_schema_privilege('anon','miniapp_student_discounts','USAGE') or has_schema_privilege('authenticated','miniapp_student_discounts','USAGE') then raise exception 'Private schema exposed'; end if;
  if has_function_privilege('anon','public.miniapp_student_discounts_dispatch(uuid,text,jsonb)','EXECUTE') or has_function_privilege('authenticated','public.student_discounts_import(jsonb)','EXECUTE') then raise exception 'Privileged RPC exposed'; end if;
  if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='miniapp_student_discounts' and c.relkind='r' and not c.relrowsecurity) then raise exception 'Missing RLS'; end if;
  if not miniapp_student_discounts.valid_content(value) then raise exception 'Valid offer rejected'; end if;
  if miniapp_student_discounts.valid_content(jsonb_set(value,'{title}','"{{state.secret}}"')) then raise exception 'Template injection accepted'; end if;
  if miniapp_student_discounts.valid_content(jsonb_set(value,'{source_url}','"https://127.0.0.1/"')) then raise exception 'Private IP URL accepted'; end if;
  if miniapp_student_discounts.valid_content(jsonb_set(value,'{category}','"__proto__"')) then raise exception 'Unknown category accepted'; end if;
  if miniapp_student_discounts.valid_content(value-'eligibility') then raise exception 'Missing required field accepted'; end if;

  forbidden:=false;
  begin perform public.miniapp_student_discounts_dispatch(extensions.gen_random_uuid(),'state'); exception when insufficient_privilege then forbidden:=true; end;
  if not forbidden then raise exception 'Missing auth user accepted'; end if;
  result := public.student_discounts_import(jsonb_build_object('schema_version',1,'generated_at',now(),'offers',jsonb_build_array(value||jsonb_build_object('id','test-student-offer','source_status','checked','verified_at',now(),'checked_at',now(),'source_sha256',repeat('a',64)))));
  if result->>'imported' <> '1' then raise exception 'Import failed'; end if;
  perform public.student_discounts_import(jsonb_build_object('schema_version',1,'generated_at',now(),'offers',jsonb_build_array(value||jsonb_build_object('id','test-unconfirmed','source_status','unavailable','verified_at',null,'checked_at',now()))));
  if (select verified_at from miniapp_student_discounts.offers where id='test-unconfirmed') is not null then raise exception 'Invented evidence date'; end if;
  perform public.student_discounts_import(jsonb_build_object('schema_version',1,'generated_at',now(),'offers',jsonb_build_array(value||jsonb_build_object('id','test-student-offer','benefit','Скидка 99%','source_status','changed','verified_at',null,'checked_at',now()))));
  if (select content->>'benefit' from miniapp_student_discounts.offers where id='test-student-offer')<>'Скидка 20%' or (select verified_at from miniapp_student_discounts.offers where id='test-student-offer') is null then raise exception 'Unconfirmed import replaced verified content'; end if;

  perform public.miniapp_student_discounts_dispatch(actor,'favorite','{"id":"test-student-offer","saved":true}');
  perform public.miniapp_student_discounts_dispatch(actor,'favorite','{"id":"test-student-offer","saved":true}');
  if (select count(*) from miniapp_student_discounts.favorites where user_id=actor) <> 1 then raise exception 'Duplicate favorite'; end if;
  result:=public.miniapp_student_discounts_dispatch(other_user,'state');
  if exists(select 1 from jsonb_array_elements(result->'offers') o where o->>'id'='test-student-offer' and (o->>'saved')::boolean) then raise exception 'Favorite leaked across users'; end if;

  result:=public.miniapp_student_discounts_dispatch(actor,'suggest',jsonb_build_object('content',value));
  suggestion_id:=(result->>'id')::uuid;
  perform public.miniapp_student_discounts_dispatch(actor,'suggest',jsonb_build_object('content',value));
  if (select count(*) from miniapp_student_discounts.suggestions where user_id=actor)<>1 then raise exception 'Duplicate suggestion'; end if;
  if (select uses from miniapp_student_discounts.daily_usage where user_id=actor and action='suggest')<>1 then raise exception 'Retry consumed quota'; end if;
  if jsonb_array_length(public.miniapp_student_discounts_dispatch(other_user,'state')->'suggestions')<>0 then raise exception 'Private suggestion leaked'; end if;

  forbidden:=false;
  begin perform public.miniapp_student_discounts_dispatch(other_user,'withdraw',jsonb_build_object('id',suggestion_id)); exception when no_data_found then forbidden:=true; end;
  if not forbidden then raise exception 'Other user withdrew suggestion'; end if;
  forbidden:=false;
  begin perform public.miniapp_student_discounts_dispatch(actor,'moderate',jsonb_build_object('id',suggestion_id,'decision','approve','note','Проверено')); exception when insufficient_privilege then forbidden:=true; end;
  if not forbidden then raise exception 'Student approved suggestion'; end if;

  select updated_at into reviewed_version from miniapp_student_discounts.suggestions where id=suggestion_id;
  perform public.miniapp_student_discounts_dispatch(actor,'suggest',jsonb_build_object('id',suggestion_id,'content',value||jsonb_build_object('title','Изменённое предложение')));
  forbidden:=false;
  begin perform public.miniapp_student_discounts_dispatch(moderator,'moderate',jsonb_build_object('id',suggestion_id,'decision','approve','note','Условия подтверждены','expected_updated_at',reviewed_version)); exception when serialization_failure then forbidden:=true; end;
  if not forbidden then raise exception 'Unreviewed content published'; end if;
  select updated_at into reviewed_version from miniapp_student_discounts.suggestions where id=suggestion_id;
  perform public.miniapp_student_discounts_dispatch(moderator,'moderate',jsonb_build_object('id',suggestion_id,'decision','approve','note','Условия подтверждены','expected_updated_at',reviewed_version));
  community_id:='community-'||suggestion_id::text;
  if not exists(select 1 from miniapp_student_discounts.offers where id=community_id and origin='community') then raise exception 'Approved offer missing'; end if;
  forbidden:=false;
  begin perform public.miniapp_student_discounts_dispatch(actor,'suggest',jsonb_build_object('id',suggestion_id,'content',value)); exception when no_data_found then forbidden:=true; end;
  if not forbidden then raise exception 'Published offer edited without moderation'; end if;

  perform public.miniapp_student_discounts_dispatch(actor,'report',jsonb_build_object('id',community_id,'reason','conditions','details','Условия изменились'));
  perform public.miniapp_student_discounts_dispatch(actor,'report',jsonb_build_object('id',community_id,'reason','conditions','details','Повторная отправка'));
  if (select count(*) from miniapp_student_discounts.reports where user_id=actor)<>1 then raise exception 'Duplicate report'; end if;
  select id into report_id from miniapp_student_discounts.reports where user_id=actor;
  perform public.miniapp_student_discounts_dispatch(moderator,'moderate',jsonb_build_object('id',report_id,'decision','pause_offer','note','Условия больше не действуют'));
  if exists(select 1 from jsonb_array_elements(public.miniapp_student_discounts_dispatch(other_user,'state')->'offers') o where o->>'id'=community_id) then raise exception 'Paused offer public'; end if;

  for i in 1..3 loop
    perform public.miniapp_student_discounts_dispatch(actor,'suggest',jsonb_build_object('content',value||jsonb_build_object('title','Дополнительное предложение '||i)));
  end loop;
  forbidden:=false;
  begin perform public.miniapp_student_discounts_dispatch(actor,'suggest',jsonb_build_object('content',value||jsonb_build_object('title','Сверх лимита'))); exception when raise_exception then forbidden:=true; end;
  if not forbidden then raise exception 'Daily quota bypassed'; end if;
  if (select uses from miniapp_student_discounts.daily_usage where user_id=actor and action='suggest')<>5 then raise exception 'Quota corrupt after rejection'; end if;

  result:=public.student_discounts_import(jsonb_build_object('schema_version',1,'generated_at',now()+interval '1 minute','offers',jsonb_build_array(value||jsonb_build_object('id','test-unconfirmed','source_status','unavailable','verified_at',null,'checked_at',now()))));
  if (select retired_at from miniapp_student_discounts.offers where id='test-student-offer') is null then raise exception 'Omitted curated offer not retired'; end if;
  if (select retired_at from miniapp_student_discounts.offers where id=community_id) is not null then raise exception 'Community offer retired by source import'; end if;
  if jsonb_array_length(public.miniapp_student_discounts_dispatch(other_user,'state','{"id":"test-student-offer"}')->'offers')<>0 then raise exception 'Retired offer still public'; end if;
  result:=public.miniapp_student_discounts_dispatch(actor,'state','{"id":"test-student-offer"}');
  if result#>>'{offers,0,status}'<>'paused' then raise exception 'Saved retired offer not marked unavailable'; end if;
  result:=public.student_discounts_import(jsonb_build_object('schema_version',1,'generated_at',now(),'offers',jsonb_build_array(value||jsonb_build_object('id','test-student-offer','source_status','checked','verified_at',now(),'checked_at',now(),'source_sha256',repeat('a',64)))));
  if result->>'skipped'<>'true' or (select retired_at from miniapp_student_discounts.offers where id='test-student-offer') is null then raise exception 'Stale catalog changed retirement'; end if;
  if (select retired_at from miniapp_student_discounts.offers where id='test-unconfirmed') is not null then raise exception 'Stale replay retired newer offer'; end if;
  update miniapp_student_discounts.offers set status='paused' where id='test-student-offer';
  perform public.student_discounts_import(jsonb_build_object('schema_version',1,'generated_at',now()+interval '2 minutes','offers',jsonb_build_array(value||jsonb_build_object('id','test-student-offer','source_status','checked','verified_at',now(),'checked_at',now(),'source_sha256',repeat('a',64)))));
  if (select retired_at from miniapp_student_discounts.offers where id='test-student-offer') is not null or (select status from miniapp_student_discounts.offers where id='test-student-offer')<>'paused' then raise exception 'Reappearance lost moderation decision'; end if;
end;
$$;

reset role;
rollback;
