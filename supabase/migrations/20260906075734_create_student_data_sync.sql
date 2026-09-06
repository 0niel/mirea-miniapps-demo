begin;

create schema if not exists miniapp_data_sync;
revoke all on schema miniapp_data_sync from public, anon, authenticated;
grant usage on schema miniapp_data_sync to service_role;

create table miniapp_data_sync.state (
  id boolean primary key default true check (id),
  revision text,
  completed_revision text,
  manifest jsonb,
  cursor integer not null default 0 check (cursor >= 0),
  total integer not null default 0 check (total between 0 and 4096),
  lease uuid,
  locked_until timestamptz,
  checked_at timestamptz,
  completed_at timestamptz,
  last_error text,
  check (cursor <= total)
);
alter table miniapp_data_sync.state enable row level security;
grant select, insert, update on miniapp_data_sync.state to service_role;
insert into miniapp_data_sync.state (id) values (true);

create function public.student_data_sync_control(p_action text, p_payload jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  s miniapp_data_sync.state;
  v_lease uuid;
begin
  if current_user <> 'service_role' and not pg_has_role(current_user, 'service_role', 'MEMBER') then
    raise insufficient_privilege using message = 'Service access required';
  end if;
  if p_action = 'status' then
    select * into s from miniapp_data_sync.state where id;
    return jsonb_build_object('revision', s.revision, 'completedRevision', s.completed_revision,
      'cursor', s.cursor, 'total', s.total, 'completedAt', s.completed_at,
      'checkedAt', s.checked_at, 'error', s.last_error,
      'busy', coalesce(s.locked_until > now(), false));
  end if;
  select * into s from miniapp_data_sync.state where id for update;
  if p_action = 'acquire' then
    if s.locked_until > now() or
      ((s.cursor = s.total or s.last_error is not null) and s.checked_at > now() - interval '2 minutes') then
      return jsonb_build_object('acquired', false);
    end if;
    v_lease := gen_random_uuid();
    update miniapp_data_sync.state set lease = v_lease,
      locked_until = now() + interval '90 seconds', checked_at = now() where id;
    return jsonb_build_object('acquired', true, 'lease', v_lease, 'revision', s.revision,
      'manifest', s.manifest, 'cursor', s.cursor, 'total', s.total, 'error', s.last_error);
  end if;
  if s.lease is null or s.lease is distinct from (p_payload->>'lease')::uuid or s.locked_until <= now() then
    raise exception 'Sync lease expired';
  end if;
  if p_action = 'begin' then
    if p_payload->>'revision' !~ '^[0-9a-f]{40}$'
      or jsonb_typeof(p_payload->'manifest'->'assets') <> 'array'
      or jsonb_array_length(p_payload->'manifest'->'assets') not between 1 and 4096 then
      raise exception 'Invalid source manifest';
    end if;
    update miniapp_data_sync.state set revision = p_payload->>'revision',
      manifest = p_payload->'manifest', cursor = 0,
      total = jsonb_array_length(p_payload->'manifest'->'assets'), last_error = null where id;
  elsif p_action = 'advance' then
    if (p_payload->>'cursor')::integer <> s.cursor + 1 then
      raise exception 'Out of order sync';
    end if;
    update miniapp_data_sync.state set cursor = s.cursor + 1,
      completed_revision = case when s.cursor + 1 = s.total then s.revision else s.completed_revision end,
      completed_at = case when s.cursor + 1 = s.total then now() else s.completed_at end,
      last_error = null where id;
  elsif p_action = 'release' then
    update miniapp_data_sync.state set lease = null, locked_until = null,
      last_error = nullif(left(p_payload->>'error', 240), '') where id;
  else
    raise exception 'Unknown sync action';
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.student_data_sync_control(text, jsonb) from public, anon, authenticated;
grant execute on function public.student_data_sync_control(text, jsonb) to service_role;

commit;
