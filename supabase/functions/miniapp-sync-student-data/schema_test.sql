begin;
set local role service_role;
update miniapp_data_sync.state set revision = null, completed_revision = null,
  manifest = null, cursor = 0, total = 0, lease = null, locked_until = null,
  checked_at = null, completed_at = null, last_error = null where id;
do $$
declare acquired jsonb;
begin
  if has_function_privilege('anon', 'public.student_data_sync_control(text,jsonb)', 'execute') then raise exception 'Anon can sync'; end if;
  if has_function_privilege('authenticated', 'public.student_data_sync_control(text,jsonb)', 'execute') then raise exception 'User can sync'; end if;
  acquired := public.student_data_sync_control('acquire');
  if acquired->>'acquired' <> 'true' then raise exception 'Cannot acquire'; end if;
  if public.student_data_sync_control('acquire')->>'acquired' <> 'false' then raise exception 'Concurrent lock not held'; end if;
  perform public.student_data_sync_control('begin', jsonb_build_object('lease', acquired->>'lease', 'revision', repeat('a', 40), 'manifest', jsonb_build_object('assets', jsonb_build_array(jsonb_build_object('test', true)))));
  perform public.student_data_sync_control('release', jsonb_build_object('lease', acquired->>'lease', 'error', 'Invalid source'));
  if public.student_data_sync_control('acquire')->>'acquired' <> 'false' then raise exception 'Failure cooldown missing'; end if;
  update miniapp_data_sync.state set checked_at = now() - interval '3 minutes' where id;
  acquired := public.student_data_sync_control('acquire');
  if acquired->>'acquired' <> 'true' or acquired->>'error' <> 'Invalid source' then raise exception 'Failure recovery state missing'; end if;
  perform public.student_data_sync_control('begin', jsonb_build_object('lease', acquired->>'lease', 'revision', repeat('b', 40), 'manifest', jsonb_build_object('assets', jsonb_build_array(jsonb_build_object('fixed', true)))));
  perform public.student_data_sync_control('advance', jsonb_build_object('lease', acquired->>'lease', 'cursor', 1));
  if public.student_data_sync_control('status')->>'completedRevision' <> repeat('b',40) then raise exception 'Completion not tracked'; end if;
  perform public.student_data_sync_control('release', jsonb_build_object('lease', acquired->>'lease'));
  if public.student_data_sync_control('acquire')->>'acquired' <> 'false' then raise exception 'Success cooldown missing'; end if;
end;
$$;
rollback;
