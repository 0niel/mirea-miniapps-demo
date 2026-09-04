create or replace function miniapp_iskra.dispatch(
  p_user_id uuid,
  p_action text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_profile miniapp_iskra.profiles%rowtype;
  v_target miniapp_iskra.profiles%rowtype;
  v_target_id uuid;
  v_match_id uuid;
  v_first uuid;
  v_second uuid;
  v_decision text;
  v_existing_decision text;
  v_interests text[];
  v_old_photo_path text;
  v_action text;
  v_note text;
  v_report_id uuid;
  v_reservation_id uuid;
  v_result jsonb;
  v_cleanup_item jsonb;
begin
  if p_action = 'cleanup_batch' then
    with picked as (
      select c.bucket_id, c.object_path
      from miniapp_iskra.media_cleanup c
      where c.available_at <= now()
        and (c.locked_until is null or c.locked_until < now())
        and not exists (
          select 1 from miniapp_iskra.reports r
          where r.status = 'open'
            and r.reported_photo_path = c.object_path
        )
      order by c.created_at
      for update skip locked
      limit 20
    ), claimed as (
      update miniapp_iskra.media_cleanup c
      set locked_until = now() + interval '2 minutes',
          attempts = least(c.attempts + 1, 32767)
      from picked
      where c.bucket_id = picked.bucket_id
        and c.object_path = picked.object_path
      returning c.bucket_id, c.object_path, c.created_at
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'bucketId', q.bucket_id,
      'objectPath', q.object_path
    ) order by q.created_at), '[]'::jsonb)
    into v_result
    from claimed q;
    return jsonb_build_object('items', v_result);
  end if;

  if p_action = 'cleanup_done' then
    delete from miniapp_iskra.media_cleanup c
    where c.bucket_id = v_payload ->> 'bucketId'
      and c.object_path = v_payload ->> 'objectPath';
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'cleanup_failed' then
    update miniapp_iskra.media_cleanup c
    set last_error = left(coalesce(v_payload ->> 'error', ''), 300),
        locked_until = null,
        available_at = now() +
          least(greatest(c.attempts, 1), 10) * interval '1 minute'
    where c.bucket_id = v_payload ->> 'bucketId'
      and c.object_path = v_payload ->> 'objectPath';
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'cleanup_results' then
    for v_cleanup_item in
      select value from jsonb_array_elements(
        coalesce(v_payload -> 'items', '[]'::jsonb)
      )
    loop
      if coalesce((v_cleanup_item ->> 'ok')::boolean, false) then
        delete from miniapp_iskra.media_cleanup c
        where c.bucket_id = v_cleanup_item ->> 'bucketId'
          and c.object_path = v_cleanup_item ->> 'objectPath';
      else
        update miniapp_iskra.media_cleanup c
        set last_error = left(
              coalesce(v_cleanup_item ->> 'error', ''),
              300
            ),
            locked_until = null,
            available_at = now() +
              least(greatest(c.attempts, 1), 10) * interval '1 minute'
        where c.bucket_id = v_cleanup_item ->> 'bucketId'
          and c.object_path = v_cleanup_item ->> 'objectPath';
      end if;
    end loop;
    return jsonb_build_object('ok', true);
  end if;

  if p_user_id is null then
    raise exception 'Invalid user' using errcode = '22023';
  end if;

  if p_action = 'enqueue_cleanup' then
    if coalesce(v_payload ->> 'bucketId', '') not in (
      'mini-app-uploads', 'iskra-photos'
    ) or char_length(coalesce(v_payload ->> 'objectPath', '')) not between 1 and 1024
    or (
      v_payload ->> 'bucketId' = 'mini-app-uploads'
      and coalesce(v_payload ->> 'objectPath', '') !~
        ('^' || p_user_id::text || '/.+$')
    ) or (
      v_payload ->> 'bucketId' = 'iskra-photos'
      and coalesce(v_payload ->> 'objectPath', '') !~
        '^profiles/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
    )
    then
      raise exception 'Invalid cleanup target' using errcode = '22023';
    end if;
    insert into miniapp_iskra.media_cleanup (
      bucket_id, object_path, available_at
    ) values (
      v_payload ->> 'bucketId',
      v_payload ->> 'objectPath',
      now() + least(
        greatest(coalesce((v_payload ->> 'delaySeconds')::integer, 0), 0),
        600
      ) * interval '1 second'
    )
    on conflict (bucket_id, object_path) do update set
      available_at = least(
        miniapp_iskra.media_cleanup.available_at,
        excluded.available_at
      ),
      locked_until = null;
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'state' then
    update miniapp_iskra.profiles
    set last_active_at = now()
    where user_id = p_user_id;

    return jsonb_build_object(
      'adultConfirmed', exists (
        select 1 from miniapp_iskra.members m where m.user_id = p_user_id
      ),
      'profile', miniapp_iskra.private_profile_json(p_user_id),
      'isModerator', miniapp_iskra.is_moderator(p_user_id),
      'restrictionType', (
        select r.kind from miniapp_iskra.restrictions r
        where r.user_id = p_user_id
      ),
      'restrictionReason', (
        select r.reason from miniapp_iskra.restrictions r
        where r.user_id = p_user_id
      ),
      'temporaryUploadPrefix', (
        select p_user_id::text || '/' || a.id::text
        from core.mini_apps a
        where a.organization_id = 'mirea' and a.slug = 'iskra'
      ),
      'matchCount', (
        select count(*)
        from miniapp_iskra.matches m
        where m.first_user_id = p_user_id or m.second_user_id = p_user_id
      ),
      'pendingLikes', (
        select count(*)
        from miniapp_iskra.decisions d
        join miniapp_iskra.profiles admirer on admirer.user_id = d.actor_id
        where d.target_id = p_user_id
          and d.decision = 'like'
          and d.created_at > now() - interval '30 days'
          and admirer.status = 'active'
          and not exists (
            select 1 from miniapp_iskra.blocks b
            where (b.blocker_id = p_user_id and b.blocked_id = d.actor_id)
               or (b.blocker_id = d.actor_id and b.blocked_id = p_user_id)
          )
          and not exists (
            select 1 from miniapp_iskra.decisions mine
            where mine.actor_id = p_user_id
              and mine.target_id = d.actor_id
          )
      ),
      'decisionsRemaining', greatest(0, 40 - coalesce((
        select u.decisions
        from miniapp_iskra.daily_usage u
        where u.user_id = p_user_id and u.usage_date = current_date
      ), 0)),
      'photosRemaining', greatest(0, 5 - coalesce((
        select u.photos
        from miniapp_iskra.daily_usage u
        where u.user_id = p_user_id and u.usage_date = current_date
      ), 0))
    );
  end if;

  if p_action = 'confirm_adult' then
    if exists (
      select 1 from miniapp_iskra.restrictions r
      where r.user_id = p_user_id
    ) then
      raise exception 'Profile is blocked' using errcode = '42501';
    end if;
    if coalesce((v_payload ->> 'adultAccepted')::boolean, false) is not true
      or coalesce((v_payload ->> 'safetyAccepted')::boolean, false) is not true
    then
      raise exception 'Both confirmations are required' using errcode = '22023';
    end if;

    insert into miniapp_iskra.members (
      user_id, adult_confirmed_at, safety_accepted_at, terms_version
    ) values (p_user_id, now(), now(), '2026-09-04')
    on conflict (user_id) do update set
      adult_confirmed_at = excluded.adult_confirmed_at,
      safety_accepted_at = excluded.safety_accepted_at,
      terms_version = excluded.terms_version;

    return jsonb_build_object('ok', true);
  end if;

  if not exists (
    select 1 from miniapp_iskra.members m where m.user_id = p_user_id
  ) then
    raise exception 'Adult confirmation required' using errcode = '42501';
  end if;

  if p_action = 'save_profile' then
    if exists (
      select 1 from miniapp_iskra.restrictions r
      where r.user_id = p_user_id
    ) then
      raise exception 'Profile is blocked' using errcode = '42501';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('profile:' || p_user_id::text, 0)
    );
    select coalesce(array_agg(distinct trim(value)), '{}')
    into v_interests
    from jsonb_array_elements_text(
      coalesce(v_payload -> 'interests', '[]'::jsonb)
    ) interests(value)
    where char_length(trim(value)) between 2 and 30;

    if char_length(trim(coalesce(v_payload ->> 'displayName', ''))) not between 2 and 40
      or coalesce((v_payload ->> 'age')::integer, 0) not between 18 and 99
      or coalesce(v_payload ->> 'gender', '') not in ('man', 'woman', 'other')
      or coalesce(v_payload ->> 'lookingFor', '') not in (
        'man', 'woman', 'everyone'
      )
      or coalesce(v_payload ->> 'intent', '') not in (
        'relationship', 'date', 'communication'
      )
      or char_length(trim(coalesce(v_payload ->> 'bio', ''))) > 500
      or cardinality(v_interests) not between 1 and 8
      or char_length(coalesce(v_payload ->> 'avatarEmoji', '')) not between 1 and 8
    then
      raise exception 'Invalid profile data' using errcode = '22023';
    end if;

    insert into miniapp_iskra.profiles (
      user_id, display_name, age, gender, looking_for, intent, bio,
      interests, avatar_emoji, status, last_active_at
    ) values (
      p_user_id,
      trim(v_payload ->> 'displayName'),
      (v_payload ->> 'age')::smallint,
      v_payload ->> 'gender',
      v_payload ->> 'lookingFor',
      v_payload ->> 'intent',
      trim(coalesce(v_payload ->> 'bio', '')),
      v_interests,
      v_payload ->> 'avatarEmoji',
      'active',
      now()
    )
    on conflict (user_id) do update set
      display_name = excluded.display_name,
      age = excluded.age,
      gender = excluded.gender,
      looking_for = excluded.looking_for,
      intent = excluded.intent,
      bio = excluded.bio,
      interests = excluded.interests,
      avatar_emoji = excluded.avatar_emoji,
      status = case
        when miniapp_iskra.profiles.status = 'banned' then 'banned'
        when miniapp_iskra.profiles.status = 'paused' then 'paused'
        else 'active'
      end,
      last_active_at = now();

    return jsonb_build_object(
      'ok', true,
      'profile', miniapp_iskra.profile_json(p_user_id)
    );
  end if;

  select * into v_profile
  from miniapp_iskra.profiles p
  where p.user_id = p_user_id;

  if not found and p_action not in ('moderation_queue', 'moderate') then
    raise exception 'Profile required' using errcode = '42501';
  end if;
  if p_action not in ('delete_profile', 'moderation_queue', 'moderate')
    and exists (
      select 1 from miniapp_iskra.restrictions r
      where r.user_id = p_user_id
    )
  then
    raise exception 'Profile is blocked' using errcode = '42501';
  end if;

  if p_action = 'reserve_photo' then
    if not exists (
      select 1 from core.mini_apps a
      where a.organization_id = 'mirea'
        and a.slug = 'iskra'
        and v_payload ->> 'temporaryPath' like
          p_user_id::text || '/' || a.id::text || '/%'
    ) then
      raise exception 'Invalid photo path' using errcode = '22023';
    end if;
    insert into miniapp_iskra.daily_usage (
      user_id, usage_date, photos
    ) values (p_user_id, current_date, 1)
    on conflict (user_id, usage_date) do update set
      photos = miniapp_iskra.daily_usage.photos + 1
    where miniapp_iskra.daily_usage.photos < 5;
    if not found then
      raise exception 'Daily photo limit reached' using errcode = '54000';
    end if;
    insert into miniapp_iskra.photo_reservations (user_id, temporary_path)
    values (p_user_id, v_payload ->> 'temporaryPath')
    returning id into v_reservation_id;
    return jsonb_build_object('reservationId', v_reservation_id);
  end if;

  if p_action = 'cancel_photo' then
    delete from miniapp_iskra.photo_reservations r
    where r.id = (v_payload ->> 'reservationId')::uuid
      and r.user_id = p_user_id
    returning r.id into v_reservation_id;
    if found then
      update miniapp_iskra.daily_usage
      set photos = greatest(photos - 1, 0)
      where user_id = p_user_id and usage_date = current_date;
    end if;
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'set_photo' then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('profile:' || p_user_id::text, 0)
    );
    select * into v_profile
    from miniapp_iskra.profiles p
    where p.user_id = p_user_id
    for update;
    if not found then
      raise exception 'Profile required' using errcode = '42501';
    end if;
    if v_profile.status = 'banned' then
      raise exception 'Profile is blocked' using errcode = '42501';
    end if;
    if coalesce(v_payload ->> 'path', '') !~
      '^profiles/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
    then
      raise exception 'Invalid photo path' using errcode = '22023';
    end if;
    select r.id into v_reservation_id
    from miniapp_iskra.photo_reservations r
    where r.id = (v_payload ->> 'reservationId')::uuid
      and r.user_id = p_user_id
      and r.expires_at > now()
    for update;
    if not found then
      raise exception 'Invalid photo reservation' using errcode = '22023';
    end if;

    v_old_photo_path := v_profile.photo_path;
    if v_old_photo_path is not null
      and v_old_photo_path <> v_payload ->> 'path'
    then
      insert into miniapp_iskra.media_cleanup (bucket_id, object_path)
      values ('iskra-photos', v_old_photo_path)
      on conflict do nothing;
    end if;
    update miniapp_iskra.profiles
    set photo_path = v_payload ->> 'path',
        photo_status = 'pending',
        moderation_note = null,
        last_active_at = now()
    where user_id = p_user_id;

    delete from miniapp_iskra.photo_reservations r
    where r.id = v_reservation_id;
    delete from miniapp_iskra.media_cleanup c
    where c.bucket_id = 'iskra-photos'
      and c.object_path = v_payload ->> 'path';

    return jsonb_build_object(
      'ok', true,
      'oldPhotoPath', v_old_photo_path,
      'photoStatus', 'pending'
    );
  end if;

  if p_action = 'candidate' then
    if v_profile.status <> 'active' then
      return jsonb_build_object('candidate', null);
    end if;

    select p.* into v_target
    from miniapp_iskra.profiles p
    where p.user_id <> p_user_id
      and p.status = 'active'
      and p.photo_status <> 'rejected'
      and (v_profile.looking_for = 'everyone' or p.gender = v_profile.looking_for)
      and (p.looking_for = 'everyone' or p.looking_for = v_profile.gender)
      and not exists (
        select 1 from miniapp_iskra.blocks b
        where (b.blocker_id = p_user_id and b.blocked_id = p.user_id)
           or (b.blocker_id = p.user_id and b.blocked_id = p_user_id)
      )
      and not exists (
        select 1 from miniapp_iskra.matches m
        where (m.first_user_id = p_user_id and m.second_user_id = p.user_id)
           or (m.first_user_id = p.user_id and m.second_user_id = p_user_id)
      )
      and not exists (
        select 1 from miniapp_iskra.decisions d
        where d.actor_id = p_user_id
          and d.target_id = p.user_id
          and d.created_at > now() - interval '30 days'
      )
    order by
      (p.intent = v_profile.intent) desc,
      cardinality(array(
        select unnest(p.interests) intersect select unnest(v_profile.interests)
      )) desc,
      md5(p.user_id::text || p_user_id::text || current_date::text)
    limit 1;

    if not found then
      return jsonb_build_object('candidate', null);
    end if;

    return jsonb_build_object(
      'candidate', miniapp_iskra.profile_json(v_target.user_id)
        || jsonb_build_object(
          'sameIntent', v_target.intent = v_profile.intent,
          'sharedInterests', to_jsonb(array(
            select unnest(v_target.interests)
            intersect
            select unnest(v_profile.interests)
          ))
        )
    );
  end if;

  if p_action = 'decide' then
    if v_profile.status <> 'active' then
      raise exception 'Profile is not active' using errcode = '42501';
    end if;

    v_decision := v_payload ->> 'decision';
    if v_decision not in ('like', 'pass') then
      raise exception 'Invalid decision' using errcode = '22023';
    end if;

    select * into v_target
    from miniapp_iskra.profiles p
    where p.public_id = (v_payload ->> 'targetId')::uuid
      and p.status = 'active';
    if not found
    then
      raise exception 'Candidate is unavailable' using errcode = '22023';
    end if;
    v_target_id := v_target.user_id;
    if v_target_id = p_user_id
      or not (
        v_profile.looking_for = 'everyone'
        or v_target.gender = v_profile.looking_for
      )
      or not (
        v_target.looking_for = 'everyone'
        or v_target.looking_for = v_profile.gender
      )
      or exists (
        select 1 from miniapp_iskra.blocks b
        where (b.blocker_id = p_user_id and b.blocked_id = v_target_id)
           or (b.blocker_id = v_target_id and b.blocked_id = p_user_id)
      )
    then
      raise exception 'Candidate is unavailable' using errcode = '22023';
    end if;

    if p_user_id::text < v_target_id::text then
      v_first := p_user_id;
      v_second := v_target_id;
    else
      v_first := v_target_id;
      v_second := p_user_id;
    end if;
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_first::text || ':' || v_second::text, 0)
    );

    select d.decision into v_existing_decision
    from miniapp_iskra.decisions d
    where d.actor_id = p_user_id
      and d.target_id = v_target_id
      and d.created_at > now() - interval '30 days';
    if found then
      if v_existing_decision <> v_decision then
        raise exception 'Candidate is unavailable' using errcode = '22023';
      end if;
      v_match_id := null;
      select m.id into v_match_id
      from miniapp_iskra.matches m
      where m.first_user_id = v_first and m.second_user_id = v_second;
      return jsonb_build_object(
        'ok', true,
        'matched', v_match_id is not null,
        'matchId', v_match_id,
        'name', v_target.display_name
      );
    end if;

    insert into miniapp_iskra.daily_usage (
      user_id, usage_date, decisions
    ) values (p_user_id, current_date, 1)
    on conflict (user_id, usage_date) do update set
      decisions = miniapp_iskra.daily_usage.decisions + 1
    where miniapp_iskra.daily_usage.decisions < 40;
    if not found then
      raise exception 'Daily decision limit reached' using errcode = '54000';
    end if;

    insert into miniapp_iskra.decisions (
      actor_id, target_id, decision, opener, created_at
    ) values (
      p_user_id,
      v_target_id,
      v_decision,
      nullif(left(trim(coalesce(v_payload ->> 'opener', '')), 240), ''),
      now()
    )
    on conflict (actor_id, target_id) do update set
      decision = excluded.decision,
      opener = excluded.opener,
      created_at = excluded.created_at;

    if v_decision = 'like' and exists (
      select 1 from miniapp_iskra.decisions d
      where d.actor_id = v_target_id
        and d.target_id = p_user_id
        and d.decision = 'like'
        and d.created_at > now() - interval '30 days'
    ) then
      insert into miniapp_iskra.matches (first_user_id, second_user_id)
      values (v_first, v_second)
      on conflict (first_user_id, second_user_id) do update
      set first_user_id = excluded.first_user_id
      returning id into v_match_id;

      return jsonb_build_object(
        'ok', true,
        'matched', true,
        'matchId', v_match_id,
        'name', v_target.display_name
      );
    end if;

    return jsonb_build_object('ok', true, 'matched', false);
  end if;

  if p_action = 'matches' then
    select coalesce(jsonb_agg(item order by item ->> 'createdAt' desc), '[]'::jsonb)
    into v_result
    from (
      select jsonb_build_object(
        'matchId', m.id,
        'createdAt', m.created_at,
        'profile', miniapp_iskra.profile_json(
          case when m.first_user_id = p_user_id
            then m.second_user_id else m.first_user_id end
        ),
        'opener', (
          select d.opener from miniapp_iskra.decisions d
          where d.actor_id = case when m.first_user_id = p_user_id
              then m.second_user_id else m.first_user_id end
            and d.target_id = p_user_id
            and d.decision = 'like'
        ),
        'myConsent', mine.user_id is not null,
        'theirConsent', theirs.user_id is not null,
        'contactHandle', case
          when mine.user_id is not null and theirs.user_id is not null
            then theirs.contact_handle
          else null
        end
      ) item
      from miniapp_iskra.matches m
      left join miniapp_iskra.contact_consents mine
        on mine.match_id = m.id and mine.user_id = p_user_id
      left join miniapp_iskra.contact_consents theirs
        on theirs.match_id = m.id
        and theirs.user_id = case when m.first_user_id = p_user_id
          then m.second_user_id else m.first_user_id end
      where (m.first_user_id = p_user_id or m.second_user_id = p_user_id)
        and exists (
          select 1 from miniapp_iskra.profiles other_profile
          where other_profile.user_id = case
              when m.first_user_id = p_user_id
                then m.second_user_id else m.first_user_id end
            and other_profile.status <> 'banned'
        )
        and not exists (
          select 1 from miniapp_iskra.blocks b
          where (b.blocker_id = p_user_id and b.blocked_id = case
              when m.first_user_id = p_user_id
                then m.second_user_id else m.first_user_id end)
             or (b.blocked_id = p_user_id and b.blocker_id = case
              when m.first_user_id = p_user_id
                then m.second_user_id else m.first_user_id end)
        )
      order by m.created_at desc, m.id
      limit 20
    ) matches_data;
    return jsonb_build_object('matches', v_result);
  end if;

  if p_action = 'set_contact' then
    v_match_id := (v_payload ->> 'matchId')::uuid;
    if coalesce(v_payload ->> 'handle', '') !~ '^[A-Za-z0-9_]{5,32}$'
      or not exists (
        select 1 from miniapp_iskra.matches m
        where m.id = v_match_id
          and (m.first_user_id = p_user_id or m.second_user_id = p_user_id)
      )
    then
      raise exception 'Invalid contact consent' using errcode = '22023';
    end if;

    insert into miniapp_iskra.contact_consents (
      match_id, user_id, contact_handle, confirmed_at
    ) values (
      v_match_id, p_user_id, v_payload ->> 'handle', now()
    )
    on conflict (match_id, user_id) do update set
      contact_handle = excluded.contact_handle,
      confirmed_at = excluded.confirmed_at;

    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'revoke_contact' then
    v_match_id := (v_payload ->> 'matchId')::uuid;
    if not exists (
      select 1 from miniapp_iskra.matches m
      where m.id = v_match_id
        and (m.first_user_id = p_user_id or m.second_user_id = p_user_id)
    ) then
      raise exception 'Invalid match' using errcode = '22023';
    end if;
    delete from miniapp_iskra.contact_consents c
    where c.match_id = v_match_id and c.user_id = p_user_id;
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'pause' then
    if v_profile.status <> 'banned' then
      update miniapp_iskra.profiles set status = 'paused'
      where user_id = p_user_id;
    end if;
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'resume' then
    if v_profile.status = 'banned' or exists (
      select 1 from miniapp_iskra.restrictions r
      where r.user_id = p_user_id
    ) then
      raise exception 'Profile is blocked' using errcode = '42501';
    end if;
    update miniapp_iskra.profiles
    set status = 'active', last_active_at = now()
    where user_id = p_user_id;
    return jsonb_build_object('ok', true);
  end if;

  if p_action in ('block', 'report') then
    select p.user_id into v_target_id
    from miniapp_iskra.profiles p
    where p.public_id = (v_payload ->> 'targetId')::uuid;
    if not found or v_target_id = p_user_id then
      raise exception 'Invalid target' using errcode = '22023';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('profile:' || v_target_id::text, 0)
    );
    select * into v_target
    from miniapp_iskra.profiles p
    where p.user_id = v_target_id
    for update;
    if not found then
      raise exception 'Invalid target' using errcode = '22023';
    end if;

    insert into miniapp_iskra.blocks (blocker_id, blocked_id)
    values (p_user_id, v_target_id)
    on conflict do nothing;

    delete from miniapp_iskra.matches m
    where (m.first_user_id = p_user_id and m.second_user_id = v_target_id)
       or (m.first_user_id = v_target_id and m.second_user_id = p_user_id);

    if p_action = 'report' then
      if coalesce(v_payload ->> 'reason', '') not in (
        'fake', 'harassment', 'inappropriate', 'underage', 'other'
      ) then
        raise exception 'Invalid report reason' using errcode = '22023';
      end if;

      select r.id into v_report_id
      from miniapp_iskra.reports r
      where r.reporter_id = p_user_id
        and r.reported_id = v_target_id
        and r.status = 'open';

      if v_report_id is null then
        insert into miniapp_iskra.reports (
          reporter_id, reported_id, reason, details, profile_snapshot,
          reported_photo_path
        ) values (
          p_user_id,
          v_target_id,
          v_payload ->> 'reason',
          left(trim(coalesce(v_payload ->> 'details', '')), 500),
          jsonb_build_object(
            'displayName', v_target.display_name,
            'age', v_target.age,
            'bio', v_target.bio,
            'interests', to_jsonb(v_target.interests),
            'photoPath', v_target.photo_path,
            'photoStatus', v_target.photo_status,
            'photoVersion', case when v_target.photo_path is null
              then null else pg_catalog.md5(v_target.photo_path) end
          ),
          v_target.photo_path
        ) returning id into v_report_id;
      end if;

      if (
        select count(distinct r.reporter_id)
        from miniapp_iskra.reports r
        where r.reported_id = v_target_id
          and r.status = 'open'
          and r.created_at > now() - interval '30 days'
      ) >= 3 then
        insert into miniapp_iskra.restrictions (
          user_id, public_id, kind, reason
        )
        select p.user_id, p.public_id, 'review',
          'Анкета временно скрыта на время проверки жалоб'
        from miniapp_iskra.profiles p
        where p.user_id = v_target_id
        on conflict (user_id) do update set
          kind = case
            when miniapp_iskra.restrictions.kind = 'banned'
              then 'banned'
            else 'review'
          end,
          reason = case
            when miniapp_iskra.restrictions.kind = 'banned'
              then miniapp_iskra.restrictions.reason
            else excluded.reason
          end;
        update miniapp_iskra.profiles
        set status = case when status = 'banned' then status else 'paused' end
        where user_id = v_target_id;
      end if;
    end if;

    return jsonb_build_object('ok', true, 'reportId', v_report_id);
  end if;

  if p_action = 'delete_profile' then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('profile:' || p_user_id::text, 0)
    );
    select * into v_profile
    from miniapp_iskra.profiles p
    where p.user_id = p_user_id
    for update;
    if not found then
      raise exception 'Profile required' using errcode = '42501';
    end if;
    if exists (
      select 1 from miniapp_iskra.reports r
      where r.reported_id = p_user_id and r.status = 'open'
    ) then
      insert into miniapp_iskra.restrictions (
        user_id, public_id, kind, reason
      ) values (
        p_user_id,
        v_profile.public_id,
        'review',
        'Анкета удалена до завершения проверки жалобы'
      )
      on conflict (user_id) do update set
        kind = case
          when miniapp_iskra.restrictions.kind = 'banned'
            then 'banned'
          else 'review'
        end,
        reason = case
          when miniapp_iskra.restrictions.kind = 'banned'
            then miniapp_iskra.restrictions.reason
          else excluded.reason
        end;
    end if;
    v_old_photo_path := v_profile.photo_path;
    if v_old_photo_path is not null then
      insert into miniapp_iskra.media_cleanup (bucket_id, object_path)
      values ('iskra-photos', v_old_photo_path)
      on conflict do nothing;
    end if;
    insert into miniapp_iskra.media_cleanup (bucket_id, object_path)
    select 'mini-app-uploads', o.name
    from storage.objects o
    join core.mini_apps a
      on a.organization_id = 'mirea'
     and a.slug = 'iskra'
     and pg_catalog.split_part(o.name, '/', 2) = a.id::text
    where o.bucket_id = 'mini-app-uploads'
      and pg_catalog.split_part(o.name, '/', 1) = p_user_id::text
    on conflict do nothing;
    delete from miniapp_iskra.members where user_id = p_user_id;
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'moderation_queue' then
    if not miniapp_iskra.is_moderator(p_user_id) then
      raise exception 'Moderator access required' using errcode = '42501';
    end if;

    select coalesce(
      jsonb_agg(item order by item ->> 'createdAt'),
      '[]'::jsonb
    ) into v_result
    from (
      select jsonb_build_object(
        'publicId', subject.public_id,
        'createdAt', subject.created_at,
        'profile', subject.profile,
        'openReports', (
          select count(*) from miniapp_iskra.reports r
          where r.reported_id = subject.user_id and r.status = 'open'
        ),
        'reports', coalesce((
          select jsonb_agg(jsonb_build_object(
            'reportId', recent.id,
            'reason', recent.reason,
            'details', recent.details,
            'profileSnapshot', recent.profile_snapshot,
            'createdAt', recent.created_at
          ) order by recent.created_at)
          from (
            select
              r.id, r.reason, r.details, r.profile_snapshot, r.created_at
            from miniapp_iskra.reports r
            where r.reported_id = subject.user_id and r.status = 'open'
            order by r.created_at
            limit 5
          ) recent
        ), '[]'::jsonb)
      ) item
      from (
        select
          p.user_id,
          p.public_id,
          p.created_at,
          miniapp_iskra.private_profile_json(p.user_id) profile
        from miniapp_iskra.profiles p
        where p.photo_status = 'pending'
           or exists (
             select 1 from miniapp_iskra.reports r
             where r.reported_id = p.user_id and r.status = 'open'
           )
           or exists (
             select 1 from miniapp_iskra.restrictions x
             where x.user_id = p.user_id
           )
        union all
        select
          x.user_id,
          x.public_id,
          x.created_at,
          jsonb_build_object(
            'displayName', 'Удалённая анкета',
            'status', case when x.kind = 'banned' then 'banned' else 'paused' end,
            'restrictionType', x.kind,
            'restrictionReason', x.reason,
            'photoStatus', 'none'
          ) profile
        from miniapp_iskra.restrictions x
        where not exists (
          select 1 from miniapp_iskra.profiles p where p.user_id = x.user_id
        )
      ) subject
      order by subject.created_at, subject.user_id
      limit 6
    ) queue_data;
    return jsonb_build_object('queue', v_result);
  end if;

  if p_action = 'moderate' then
    if not miniapp_iskra.is_moderator(p_user_id) then
      raise exception 'Moderator access required' using errcode = '42501';
    end if;
    v_action := v_payload ->> 'moderationAction';
    v_note := left(trim(coalesce(v_payload ->> 'note', '')), 500);
    select * into v_target from miniapp_iskra.profiles p
    where p.public_id = (v_payload ->> 'targetId')::uuid for update;
    if not found then
      if v_action not in (
        'restore', 'ban', 'resolve_report', 'dismiss_report'
      ) then
        raise exception 'Invalid moderation action' using errcode = '22023';
      end if;
      select r.user_id into v_target_id
      from miniapp_iskra.restrictions r
      where r.public_id = (v_payload ->> 'targetId')::uuid
      for update;
      if not found then
        raise exception 'Invalid moderation action' using errcode = '22023';
      end if;
      if v_action = 'restore' then
        if exists (
          select 1 from miniapp_iskra.reports r
          where r.reported_id = v_target_id and r.status = 'open'
        ) then
          raise exception 'Resolve open reports before restoring profile'
            using errcode = '40001';
        end if;
        delete from miniapp_iskra.restrictions r
        where r.user_id = v_target_id;
      elsif v_action = 'ban' then
        update miniapp_iskra.restrictions r
        set kind = 'banned', reason = v_note, imposed_by = p_user_id
        where r.user_id = v_target_id;
      else
        v_report_id := (v_payload ->> 'reportId')::uuid;
        if not exists (
          select 1 from miniapp_iskra.reports r
          where r.id = v_report_id
            and r.reported_id = v_target_id
            and r.status = 'open'
        ) then
          raise exception 'Report changed, refresh moderation queue'
            using errcode = '40001';
        end if;
        update miniapp_iskra.reports
        set status = case when v_action = 'resolve_report'
              then 'resolved' else 'dismissed' end,
            resolution_note = v_note,
            resolved_by = p_user_id,
            resolved_at = now()
        where id = v_report_id;
      end if;
      insert into miniapp_iskra.moderation_log (
        moderator_id, subject_id, action, notes
      ) values (p_user_id, v_target_id, v_action, v_note);
      return jsonb_build_object('ok', true);
    end if;
    if v_action not in (
      'approve_photo', 'reject_photo', 'ban', 'restore',
      'resolve_report', 'dismiss_report'
    ) then
      raise exception 'Invalid moderation action' using errcode = '22023';
    end if;
    v_target_id := v_target.user_id;

    if v_action = 'restore' and exists (
      select 1 from miniapp_iskra.reports r
      where r.reported_id = v_target_id and r.status = 'open'
    ) then
      raise exception 'Resolve open reports before restoring profile'
        using errcode = '40001';
    end if;

    if v_action in ('approve_photo', 'reject_photo') and (
      v_target.photo_status <> 'pending'
      or coalesce(v_payload ->> 'photoVersion', '') <>
        coalesce(pg_catalog.md5(v_target.photo_path), '')
    ) then
      raise exception 'Photo changed, refresh moderation queue'
        using errcode = '40001';
    end if;

    v_old_photo_path := null;
    if v_action = 'approve_photo' and v_target.photo_path is not null then
      update miniapp_iskra.profiles
      set photo_status = 'approved', moderation_note = null
      where user_id = v_target_id;
    elsif v_action = 'reject_photo' then
      v_old_photo_path := v_target.photo_path;
      if v_old_photo_path is not null then
        insert into miniapp_iskra.media_cleanup (bucket_id, object_path)
        values ('iskra-photos', v_old_photo_path)
        on conflict do nothing;
      end if;
      update miniapp_iskra.profiles
      set photo_path = null, photo_status = 'rejected', moderation_note = v_note
      where user_id = v_target_id;
    elsif v_action = 'ban' then
      insert into miniapp_iskra.restrictions (
        user_id, public_id, kind, reason, imposed_by
      ) values (
        v_target_id, v_target.public_id, 'banned', v_note, p_user_id
      )
      on conflict (user_id) do update set
        kind = 'banned',
        reason = excluded.reason,
        imposed_by = excluded.imposed_by;
      update miniapp_iskra.profiles
      set status = 'banned', moderation_note = v_note
      where user_id = v_target_id;
      delete from miniapp_iskra.matches m
      where m.first_user_id = v_target_id or m.second_user_id = v_target_id;
    elsif v_action = 'restore' then
      delete from miniapp_iskra.restrictions r
      where r.user_id = v_target_id;
      update miniapp_iskra.profiles
      set status = 'active', moderation_note = null
      where user_id = v_target_id;
    elsif v_action in ('resolve_report', 'dismiss_report') then
      v_report_id := (v_payload ->> 'reportId')::uuid;
      if not exists (
        select 1 from miniapp_iskra.reports r
        where r.id = v_report_id
          and r.reported_id = v_target_id
          and r.status = 'open'
      ) then
        raise exception 'Report changed, refresh moderation queue'
          using errcode = '40001';
      end if;
      update miniapp_iskra.reports
      set status = case when v_action = 'resolve_report'
          then 'resolved' else 'dismissed' end,
          resolution_note = v_note,
          resolved_by = p_user_id,
          resolved_at = now()
      where id = v_report_id;
    end if;

    insert into miniapp_iskra.moderation_log (
      moderator_id, subject_id, action, notes
    ) values (p_user_id, v_target_id, v_action, v_note);

    return jsonb_build_object(
      'ok', true,
      'photoPathToDelete', v_old_photo_path
    );
  end if;

  raise exception 'Unknown action' using errcode = '22023';
end;
$$;

update storage.buckets
set public = false,
    file_size_limit = 5242880,
    allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp']
where id = 'iskra-photos';

