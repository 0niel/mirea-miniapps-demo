begin;

create or replace function miniapp_iskra.pending_likes(p_user_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_profile miniapp_iskra.profiles%rowtype;
  v_result jsonb;
begin
  select * into v_profile from miniapp_iskra.profiles p where p.user_id = p_user_id;
  if not found or v_profile.status <> 'active' then
    return jsonb_build_object('pending', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(item order by item ->> 'createdAt' desc), '[]'::jsonb)
  into v_result
  from (
    select miniapp_iskra.profile_json(d.actor_id) || jsonb_build_object(
      'createdAt', d.created_at,
      'opener', d.opener,
      'sameIntent', admirer.intent = v_profile.intent,
      'sharedInterests', to_jsonb(array(
        select unnest(admirer.interests)
        intersect
        select unnest(v_profile.interests)
      ))
    ) as item
    from miniapp_iskra.decisions d
    join miniapp_iskra.profiles admirer on admirer.user_id = d.actor_id
    where d.target_id = p_user_id
      and d.decision = 'like'
      and d.created_at > now() - interval '30 days'
      and admirer.status = 'active'
      and admirer.photo_status <> 'rejected'
      and (v_profile.looking_for = 'everyone' or admirer.gender = v_profile.looking_for)
      and (admirer.looking_for = 'everyone' or admirer.looking_for = v_profile.gender)
      and not exists (
        select 1 from miniapp_iskra.blocks b
        where (b.blocker_id = p_user_id and b.blocked_id = d.actor_id)
           or (b.blocker_id = d.actor_id and b.blocked_id = p_user_id)
      )
      and not exists (
        select 1 from miniapp_iskra.decisions mine
        where mine.actor_id = p_user_id and mine.target_id = d.actor_id
      )
      and not exists (
        select 1 from miniapp_iskra.matches m
        where (m.first_user_id = p_user_id and m.second_user_id = d.actor_id)
           or (m.first_user_id = d.actor_id and m.second_user_id = p_user_id)
      )
    order by d.created_at desc
    limit 50
  ) pending_data;

  return jsonb_build_object('pending', v_result);
end;
$$;

revoke all on function miniapp_iskra.pending_likes(uuid) from public, anon, authenticated;
grant execute on function miniapp_iskra.pending_likes(uuid) to service_role;

create or replace function public.iskra_pending_likes(p_user_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select miniapp_iskra.pending_likes(p_user_id);
$$;

revoke all on function public.iskra_pending_likes(uuid) from public, anon, authenticated;
grant execute on function public.iskra_pending_likes(uuid) to service_role;

commit;
