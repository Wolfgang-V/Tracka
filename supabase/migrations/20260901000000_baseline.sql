


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."accept_care_relationship"("p_relationship_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update care_relationships
  set status = 'active', accepted_at = now(), last_active_at = now()
  where id = p_relationship_id
    and client_id = auth.uid()
    and status = 'invited';

  if not found then
    raise exception 'Invitation not found or already handled';
  end if;
end;
$$;


ALTER FUNCTION "public"."accept_care_relationship"("p_relationship_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."accept_invitation"("p_token" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_invite invitations;
  v_relationship_id uuid;
begin
  select * into v_invite from invitations where token = p_token for update;

  if not found then
    raise exception 'Invitation not found';
  end if;

  if v_invite.used_at is not null then
    raise exception 'Invitation already used';
  end if;

  if v_invite.expires_at < now() then
    raise exception 'Invitation expired';
  end if;

  insert into care_relationships (practitioner_id, client_id, status, scopes, accepted_at, last_active_at)
  values (v_invite.practitioner_id, auth.uid(), 'active', v_invite.scopes, now(), now())
  on conflict (practitioner_id, client_id) where status in ('invited', 'active')
  do update set status = 'active', scopes = v_invite.scopes, accepted_at = now(), last_active_at = now()
  returning id into v_relationship_id;

  update invitations set used_at = now(), used_by = auth.uid() where token = p_token;

  return v_relationship_id;
end;
$$;


ALTER FUNCTION "public"."accept_invitation"("p_token" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."accept_recommendation"("p_recommendation_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_rec recommendations;
  v_item record;
  v_user_product_id uuid;
  v_am_steps jsonb := '[]'::jsonb;
  v_pm_steps jsonb := '[]'::jsonb;
  v_order_am int := 0;
  v_order_pm int := 0;
  v_routine_code text := 'TRK-' || right(extract(epoch from clock_timestamp())::bigint::text, 6);
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_rec from recommendations where id = p_recommendation_id for update;

  if not found then
    raise exception 'Recommendation not found';
  end if;

  if v_rec.client_id <> v_user_id then
    raise exception 'Not authorized';
  end if;

  if v_rec.status <> 'proposed' then
    raise exception 'This recommendation is no longer pending';
  end if;

  if v_rec.proposes_skin_profile then
    insert into skin_profiles (user_id, gender, pregnant_or_breastfeeding, skin_type, concerns, goals, sensitivity)
    values (v_user_id, v_rec.gender, v_rec.pregnant_or_breastfeeding, v_rec.skin_type, v_rec.concerns, v_rec.goals, v_rec.sensitivity)
    on conflict (user_id) do update set
      gender = coalesce(excluded.gender, skin_profiles.gender),
      pregnant_or_breastfeeding = coalesce(excluded.pregnant_or_breastfeeding, skin_profiles.pregnant_or_breastfeeding),
      skin_type = coalesce(excluded.skin_type, skin_profiles.skin_type),
      concerns = coalesce(excluded.concerns, skin_profiles.concerns),
      goals = coalesce(excluded.goals, skin_profiles.goals),
      sensitivity = coalesce(excluded.sensitivity, skin_profiles.sensitivity);
  end if;

  for v_item in
    select ri.*, p.name as product_name
    from recommendation_items ri
    join products p on p.id = ri.product_id
    where ri.recommendation_id = p_recommendation_id
    order by ri.sort_order
  loop
    insert into user_products (user_id, product_id, is_active)
    values (v_user_id, v_item.product_id, true)
    on conflict (user_id, product_id) where is_active = true
    do update set is_active = true
    returning id into v_user_product_id;

    if v_item.slot = 'AM' then
      v_order_am := v_order_am + 1;
      v_am_steps := v_am_steps || jsonb_build_object(
        'user_product_id', v_user_product_id,
        'step_order', v_order_am,
        'step_name', v_item.product_name,
        'frequency', v_item.frequency,
        'days_of_week', v_item.days_of_week
      );
    else
      v_order_pm := v_order_pm + 1;
      v_pm_steps := v_pm_steps || jsonb_build_object(
        'user_product_id', v_user_product_id,
        'step_order', v_order_pm,
        'step_name', v_item.product_name,
        'frequency', v_item.frequency,
        'days_of_week', v_item.days_of_week
      );
    end if;
  end loop;

  if jsonb_array_length(v_am_steps) = 0 then
    select coalesce(jsonb_agg(jsonb_build_object(
      'user_product_id', rs.user_product_id,
      'step_order', rs.step_order,
      'step_name', rs.step_name,
      'frequency', rs.frequency,
      'days_of_week', rs.days_of_week
    ) order by rs.step_order), '[]'::jsonb)
    into v_am_steps
    from routine_steps rs
    join routines r on r.id = rs.routine_id
    where r.user_id = v_user_id and r.time_of_day = 'AM' and r.is_active = true and rs.is_active = true;
  end if;

  if jsonb_array_length(v_pm_steps) = 0 then
    select coalesce(jsonb_agg(jsonb_build_object(
      'user_product_id', rs.user_product_id,
      'step_order', rs.step_order,
      'step_name', rs.step_name,
      'frequency', rs.frequency,
      'days_of_week', rs.days_of_week
    ) order by rs.step_order), '[]'::jsonb)
    into v_pm_steps
    from routine_steps rs
    join routines r on r.id = rs.routine_id
    where r.user_id = v_user_id and r.time_of_day = 'PM' and r.is_active = true and rs.is_active = true;
  end if;

  if jsonb_array_length(v_am_steps) > 0 or jsonb_array_length(v_pm_steps) > 0 then
    perform create_routine(v_routine_code, v_am_steps, v_pm_steps);
  end if;

  update recommendations
  set status = 'accepted', responded_at = now()
  where id = p_recommendation_id;
end;
$$;


ALTER FUNCTION "public"."accept_recommendation"("p_recommendation_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_delete_user"("target_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_email  text;
  v_photos int;
begin
  if not exists (
    select 1 from auth.users u
    where u.id = auth.uid() and u.email = 'trackaplusapp@gmail.com'
  ) then
    raise exception 'Not authorized';
  end if;

  if target_id = auth.uid() then
    raise exception 'Cannot delete your own account';
  end if;

  select u.email::text into v_email from auth.users u where u.id = target_id;

  if v_email is null then
    raise exception 'No such user';
  end if;

  insert into storage_cleanup_queue (bucket_id, path, reason)
  select 'progress-photos', pp.path, 'user_deleted'
  from progress_photos pp
  where pp.user_id = target_id;

  get diagnostics v_photos = row_count;

  delete from progress_photos where user_id = target_id;

  insert into admin_audit_log (actor_id, action, target_id, details)
  values (auth.uid(), 'delete', target_id,
          jsonb_build_object('email', v_email, 'photos_queued', v_photos));

  delete from auth.users where id = target_id;
end;
$$;


ALTER FUNCTION "public"."admin_delete_user"("target_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_list_pending_practitioners"() RETURNS TABLE("user_id" "uuid", "email" "text", "display_name" "text", "bio" "text", "specialisms" "text"[], "instagram" "text", "whatsapp" "text", "created_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not exists (
    select 1 from auth.users u
    where u.id = auth.uid() and u.email = 'trackaplusapp@gmail.com'
  ) then
    raise exception 'Not authorized';
  end if;

  return query
  select pr.user_id, u.email::text, pr.display_name, pr.bio, pr.specialisms, pr.instagram, pr.whatsapp, pr.created_at
  from practitioners pr
  join auth.users u on u.id = pr.user_id
  where pr.verified_at is null
  order by pr.created_at asc;
end;
$$;


ALTER FUNCTION "public"."admin_list_pending_practitioners"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_list_users"() RETURNS TABLE("id" "uuid", "email" "text", "username" "text", "onboarding_completed" boolean, "created_at" timestamp with time zone, "last_sign_in_at" timestamp with time zone, "email_confirmed_at" timestamp with time zone, "banned_until" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not exists (
    select 1 from auth.users u
    where u.id = auth.uid() and u.email = 'trackaplusapp@gmail.com'
  ) then
    raise exception 'Not authorized';
  end if;

  return query
  select
    u.id,
    u.email::text,
    p.username,
    p.onboarding_completed,
    u.created_at,
    u.last_sign_in_at,
    u.email_confirmed_at,
    u.banned_until
  from auth.users u
  left join profiles p on p.id = u.id
  order by u.created_at desc;
end;
$$;


ALTER FUNCTION "public"."admin_list_users"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_review_practitioner"("target_id" "uuid", "approve" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not exists (
    select 1 from auth.users u
    where u.id = auth.uid() and u.email = 'trackaplusapp@gmail.com'
  ) then
    raise exception 'Not authorized';
  end if;

  if target_id = auth.uid() then
    raise exception 'Cannot review your own application';
  end if;

  if approve then
    update practitioners
    set verified_at = now(), verified_by = auth.uid()
    where user_id = target_id and verified_at is null;

    if not found then
      raise exception 'No pending application for that user';
    end if;

    insert into admin_audit_log (actor_id, action, target_id, details)
    values (auth.uid(), 'approve_practitioner', target_id, '{}'::jsonb);
  else
    delete from practitioners where user_id = target_id and verified_at is null;

    if not found then
      raise exception 'No pending application for that user';
    end if;

    delete from care_relationships where practitioner_id = target_id;
    delete from invitations where practitioner_id = target_id;

    insert into admin_audit_log (actor_id, action, target_id, details)
    values (auth.uid(), 'reject_practitioner', target_id, '{}'::jsonb);
  end if;
end;
$$;


ALTER FUNCTION "public"."admin_review_practitioner"("target_id" "uuid", "approve" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_suspend_user"("target_id" "uuid", "suspend" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not exists (
    select 1 from auth.users u
    where u.id = auth.uid() and u.email = 'trackaplusapp@gmail.com'
  ) then
    raise exception 'Not authorized';
  end if;

  if target_id = auth.uid() then
    raise exception 'Cannot suspend your own account';
  end if;

  update auth.users
  set banned_until = case when suspend then '2999-12-31'::timestamptz else null end
  where id = target_id;

  if not found then
    raise exception 'No such user';
  end if;

  insert into admin_audit_log (actor_id, action, target_id, details)
  values (auth.uid(),
          case when suspend then 'suspend' else 'unsuspend' end,
          target_id,
          jsonb_build_object('suspend', suspend));
end;
$$;


ALTER FUNCTION "public"."admin_suspend_user"("target_id" "uuid", "suspend" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_routine"("p_routine_code" "text", "p_am_steps" "jsonb", "p_pm_steps" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_routine_id uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  -- Without this, an empty call silently wipes the user's routine and
  -- leaves them with nothing, which looks identical to data loss.
  if coalesce(jsonb_array_length(p_am_steps), 0) = 0
     and coalesce(jsonb_array_length(p_pm_steps), 0) = 0 then
    raise exception 'A routine needs at least one step';
  end if;

  update routine_steps
  set is_active = false
  where routine_id in (
    select id from routines where user_id = v_user_id and is_active = true
  );

  update routines
  set is_active = false
  where user_id = v_user_id and is_active = true;

  if jsonb_array_length(p_am_steps) > 0 then
    insert into routines (user_id, name, time_of_day, routine_code, is_active)
    values (v_user_id, 'AM Routine', 'AM', p_routine_code, true)
    returning id into v_routine_id;

    insert into routine_steps (routine_id, user_product_id, step_order, step_name, frequency, days_of_week, is_active)
    select
      v_routine_id,
      (elem->>'user_product_id')::uuid,
      (elem->>'step_order')::int,
      elem->>'step_name',
      coalesce(elem->>'frequency', 'daily'),
      coalesce(
        (select array_agg(x::smallint) from jsonb_array_elements_text(elem->'days_of_week') as x),
        '{0,1,2,3,4,5,6}'
      ),
      true
    from jsonb_array_elements(p_am_steps) as elem;
  end if;

  if jsonb_array_length(p_pm_steps) > 0 then
    insert into routines (user_id, name, time_of_day, routine_code, is_active)
    values (v_user_id, 'PM Routine', 'PM', p_routine_code, true)
    returning id into v_routine_id;

    insert into routine_steps (routine_id, user_product_id, step_order, step_name, frequency, days_of_week, is_active)
    select
      v_routine_id,
      (elem->>'user_product_id')::uuid,
      (elem->>'step_order')::int,
      elem->>'step_name',
      coalesce(elem->>'frequency', 'daily'),
      coalesce(
        (select array_agg(x::smallint) from jsonb_array_elements_text(elem->'days_of_week') as x),
        '{0,1,2,3,4,5,6}'
      ),
      true
    from jsonb_array_elements(p_pm_steps) as elem;
  end if;
end;
$$;


ALTER FUNCTION "public"."create_routine"("p_routine_code" "text", "p_am_steps" "jsonb", "p_pm_steps" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."due_diary_nudges"("window_minutes" integer DEFAULT 6) RETURNS TABLE("user_id" "uuid", "username" "text", "subscription" "jsonb", "local_date" "date")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with settings as (
    select
      ps.user_id,
      p.username,
      ps.subscription,
      coalesce(rs.timezone, 'Africa/Lagos') as tz,
      (now() at time zone coalesce(rs.timezone, 'Africa/Lagos')) as local_now
    from push_subscriptions ps
    join profiles p on p.id = ps.user_id
    join reminder_settings rs on rs.user_id = ps.user_id
    where rs.diary_nudge_enabled
  )
  select s.user_id, s.username, s.subscription, (s.local_now)::date as local_date
  from settings s
  where s.local_now::time between time '14:00' and (time '14:00' + (window_minutes || ' minutes')::interval)
    and not exists (
      select 1 from skin_logs sl
      where sl.user_id = s.user_id
        and sl.local_date = (s.local_now)::date
        and sl.note is not null
        and trim(sl.note) <> ''
    )
    and not exists (
      select 1 from diary_nudge_log dnl
      where dnl.user_id = s.user_id
        and dnl.local_date = (s.local_now)::date
    );
$$;


ALTER FUNCTION "public"."due_diary_nudges"("window_minutes" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."due_followups"("window_minutes" integer DEFAULT 6) RETURNS TABLE("user_id" "uuid", "username" "text", "slot" "text", "local_date" "date", "subscription" "jsonb")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with settings as (
    select
      rs.user_id,
      p.username,
      ps.subscription,
      (now() at time zone coalesce(rs.timezone, 'UTC')) as local_now,
      rs.morning_enabled, rs.morning_time,
      rs.night_enabled, rs.night_time
    from reminder_settings rs
    join profiles p on p.id = rs.user_id
    join push_subscriptions ps on ps.user_id = rs.user_id
  ),
  candidates as (
    select user_id, username, subscription, 'morning'::text as slot,
           local_now::date as local_date,
           local_now,
           local_now::date + morning_time + interval '30 minutes' as target_at
    from settings
    where morning_enabled and morning_time is not null
    union all
    select user_id, username, subscription, 'night'::text as slot,
           local_now::date as local_date,
           local_now,
           local_now::date + night_time + interval '30 minutes' as target_at
    from settings
    where night_enabled and night_time is not null
  )
  select c.user_id, c.username, c.slot, c.local_date, c.subscription
  from candidates c
  where c.local_now between c.target_at and c.target_at + (window_minutes || ' minutes')::interval
    and not exists (
      select 1 from reminder_followup_log l
      where l.user_id = c.user_id and l.slot = c.slot and l.local_date = c.local_date
    )
    and exists (
      select 1 from routines r
      where r.user_id = c.user_id and r.is_active
        and r.time_of_day = (case when c.slot = 'morning' then 'AM' else 'PM' end)
    )
    and not exists (
      select 1
      from routine_step_completions comp
      join routine_steps rst on rst.id = comp.routine_step_id
      join routines r on r.id = rst.routine_id
      where comp.user_id = c.user_id
        and comp.local_date = c.local_date
        and r.time_of_day = (case when c.slot = 'morning' then 'AM' else 'PM' end)
    );
$$;


ALTER FUNCTION "public"."due_followups"("window_minutes" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."due_inactivity_nudges"() RETURNS TABLE("user_id" "uuid", "username" "text", "days_inactive" integer, "last_completed" "date", "subscription" "jsonb")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with last_active as (
    select
      ps.user_id      as uid,
      p.username      as uname,
      ps.subscription as sub,
      (now() at time zone coalesce(rs.timezone, 'UTC'))::date as today_local,
      (select max(rc.completed_date)
         from routine_completions rc
        where rc.user_id = ps.user_id) as last_done
    from push_subscriptions ps
    join profiles p           on p.id = ps.user_id
    join reminder_settings rs on rs.user_id = ps.user_id
    where rs.morning_enabled or rs.night_enabled
  ),
  spans as (
    select la.*, d.n
    from last_active la
    cross join (values (3), (7)) as d(n)
  )
  select s.uid, s.uname, s.n, s.last_done, s.sub
  from spans s
  where s.last_done is not null
    and s.last_done = s.today_local - s.n
    and not exists (
      select 1 from inactivity_nudge_log l
      where l.user_id = s.uid
        and l.days_inactive = s.n
        and l.last_completed_snapshot = s.last_done
    );
$$;


ALTER FUNCTION "public"."due_inactivity_nudges"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."due_onboarding_nudges"() RETURNS TABLE("user_id" "uuid", "username" "text", "subscription" "jsonb")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select ps.user_id, p.username, ps.subscription
  from push_subscriptions ps
  join profiles p    on p.id = ps.user_id
  join auth.users u  on u.id = ps.user_id
  -- Left join on purpose: someone who never reached the reminders screen has
  -- no settings row at all, and that's most of the people this targets.
  -- Only exclude those who explicitly switched everything off.
  left join reminder_settings rs on rs.user_id = ps.user_id
  where coalesce(p.onboarding_completed, false) = false
    and u.created_at between now() - interval '48 hours' and now() - interval '24 hours'
    and coalesce(rs.morning_enabled or rs.night_enabled, true)
    and not exists (
      select 1 from onboarding_nudge_log l where l.user_id = ps.user_id
    );
$$;


ALTER FUNCTION "public"."due_onboarding_nudges"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."due_reminders"("window_minutes" integer DEFAULT 6) RETURNS TABLE("user_id" "uuid", "username" "text", "slot" "text", "local_date" "date", "subscription" "jsonb")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select
    rs.user_id,
    pr.username,
    s.kind,
    (now() at time zone rs.timezone)::date as local_date,
    ps.subscription
  from reminder_settings rs
  join push_subscriptions ps on ps.user_id = rs.user_id
  left join profiles pr on pr.id = rs.user_id
  cross join lateral (values
    ('morning', rs.morning_enabled, rs.morning_time),
    ('night',   rs.night_enabled,   rs.night_time)
  ) as s(kind, enabled, at_time)
  where s.enabled
    and s.at_time is not null
    and (now() at time zone rs.timezone)::time >= s.at_time
    and (now() at time zone rs.timezone)::time
        < s.at_time + make_interval(mins => window_minutes)
    and not exists (
      select 1 from reminder_log rl
      where rl.user_id = rs.user_id
        and rl.slot = s.kind
        and rl.local_date = (now() at time zone rs.timezone)::date
    );
$$;


ALTER FUNCTION "public"."due_reminders"("window_minutes" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."due_spf_reminders"("window_minutes" integer DEFAULT 6) RETURNS TABLE("user_id" "uuid", "username" "text", "subscription" "jsonb", "reapply_number" integer, "local_date" "date")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with settings as (
    select
      ps.user_id,
      p.username,
      ps.subscription,
      coalesce(rs.timezone, 'UTC') as tz,
      (now() at time zone coalesce(rs.timezone, 'UTC')) as local_now
    from push_subscriptions ps
    join profiles p on p.id = ps.user_id
    join reminder_settings rs on rs.user_id = ps.user_id
    where rs.spf_reapply_enabled
  ),
  applied as (
    select
      s.user_id, s.username, s.subscription, s.local_now,
      (s.local_now)::date as local_date
    from settings s
    where exists (
      select 1
      from routines r
      join routine_steps rst on rst.routine_id = r.id and rst.is_active
      join user_products up  on up.id = rst.user_product_id
      join products pr       on pr.id = up.product_id and lower(pr.category) = 'sunscreen'
      join routine_step_completions comp
        on comp.routine_step_id = rst.id
       and comp.user_id = s.user_id
       and comp.local_date = (s.local_now)::date
      where r.user_id = s.user_id and r.is_active and r.time_of_day = 'AM'
    )
  ),
  candidates as (
    select a.user_id, a.username, a.subscription, a.local_now, a.local_date,
           1 as reapply_number, (a.local_date + time '12:00') as target_at
    from applied a
    union all
    select a.user_id, a.username, a.subscription, a.local_now, a.local_date,
           2 as reapply_number, (a.local_date + time '15:00') as target_at
    from applied a
  )
  select c.user_id, c.username, c.subscription, c.reapply_number, c.local_date
  from candidates c
  where c.local_now between c.target_at and c.target_at + (window_minutes || ' minutes')::interval
    and not exists (
      select 1 from spf_reminder_log l
      where l.user_id = c.user_id
        and l.local_date = c.local_date
        and l.reapply_number = c.reapply_number
    );
$$;


ALTER FUNCTION "public"."due_spf_reminders"("window_minutes" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  wanted text := nullif(trim(new.raw_user_meta_data ->> 'username'), '');
begin
  -- Drop the requested name if it's already taken or malformed;
  -- onboarding will ask for another. Signup must never fail here.
  if wanted is not null and (
       char_length(wanted) not between 2 and 30
       or exists (select 1 from public.profiles p
                  where lower(p.username) = lower(wanted))
     ) then
    wanted := null;
  end if;

  insert into public.profiles (id, username, onboarding_completed)
  values (new.id, wanted, false)
  on conflict (id) do nothing;

  return new;

exception when others then
  -- Never block account creation on profile setup
  insert into public.profiles (id, username, onboarding_completed)
  values (new.id, null, false)
  on conflict (id) do nothing;
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_client_access"("p_client" "uuid", "p_scope" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from care_relationships cr
    join practitioners pr on pr.user_id = cr.practitioner_id
    where cr.client_id = p_client
      and cr.practitioner_id = auth.uid()
      and cr.status = 'active'
      and p_scope = any(cr.scopes)
      and pr.verified_at is not null
  );
$$;


ALTER FUNCTION "public"."has_client_access"("p_client" "uuid", "p_scope" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lock_recommendation_fields"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if auth.uid() = old.client_id then
    new.practitioner_id := old.practitioner_id;
    new.client_id := old.client_id;
    new.note := old.note;
    new.created_at := old.created_at;
    new.proposes_skin_profile := old.proposes_skin_profile;
    new.gender := old.gender;
    new.skin_type := old.skin_type;
    new.concerns := old.concerns;
    new.goals := old.goals;
    new.sensitivity := old.sensitivity;
    new.pregnant_or_breastfeeding := old.pregnant_or_breastfeeding;

    if new.status not in ('accepted', 'declined') then
      raise exception 'Clients can only accept or decline a recommendation';
    end if;

  elsif auth.uid() = old.practitioner_id then
    new.practitioner_id := old.practitioner_id;
    new.client_id := old.client_id;
    new.note := old.note;
    new.created_at := old.created_at;
    new.proposes_skin_profile := old.proposes_skin_profile;
    new.gender := old.gender;
    new.skin_type := old.skin_type;
    new.concerns := old.concerns;
    new.goals := old.goals;
    new.sensitivity := old.sensitivity;
    new.pregnant_or_breastfeeding := old.pregnant_or_breastfeeding;

    if old.status <> 'proposed' or new.status <> 'superseded' then
      raise exception 'Practitioners can only withdraw a still-pending recommendation';
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."lock_recommendation_fields"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."practitioner_get_client_profile"("p_client" "uuid") RETURNS TABLE("skin_type" "text", "concerns" "text", "goals" "text", "sensitivity" "text", "gender" "text", "pregnant_or_breastfeeding" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not (select has_client_access(p_client, 'skin_profile')) then
    raise exception 'Not authorized';
  end if;

  insert into practitioner_access_log (practitioner_id, client_id, what)
  values (auth.uid(), p_client, 'view_skin_profile');

  return query
  select sp.skin_type, sp.concerns, sp.goals, sp.sensitivity, sp.gender, sp.pregnant_or_breastfeeding
  from skin_profiles sp
  where sp.user_id = p_client
  order by sp.created_at desc
  limit 1;
end;
$$;


ALTER FUNCTION "public"."practitioner_get_client_profile"("p_client" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."practitioner_invite_by_email"("p_email" "text", "p_scopes" "text"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_practitioner_id uuid := auth.uid();
  v_target_user_id uuid;
  v_relationship_id uuid;
  v_token uuid;
begin
  if not exists (
    select 1 from practitioners pr
    where pr.user_id = v_practitioner_id and pr.verified_at is not null
  ) then
    raise exception 'Not authorized';
  end if;

  if p_scopes is null or not (p_scopes <@ array['skin_profile', 'routine', 'daily_logs', 'photos']::text[]) then
    raise exception 'Invalid scopes';
  end if;

  select id into v_target_user_id from auth.users where lower(email) = lower(p_email) limit 1;

  if v_target_user_id is not null then
    if v_target_user_id = v_practitioner_id then
      raise exception 'You can''t add yourself as a client';
    end if;

    insert into care_relationships (practitioner_id, client_id, status, scopes)
    values (v_practitioner_id, v_target_user_id, 'invited', p_scopes)
    on conflict (practitioner_id, client_id) where status in ('invited', 'active')
    do update set scopes = excluded.scopes
    returning id into v_relationship_id;

    return jsonb_build_object('kind', 'relationship', 'id', v_relationship_id);
  else
    insert into invitations (practitioner_id, invited_email, scopes)
    values (v_practitioner_id, lower(p_email), p_scopes)
    returning token into v_token;

    return jsonb_build_object('kind', 'invitation', 'token', v_token);
  end if;
end;
$$;


ALTER FUNCTION "public"."practitioner_invite_by_email"("p_email" "text", "p_scopes" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."practitioner_list_clients"() RETURNS TABLE("relationship_id" "uuid", "client_id" "uuid", "username" "text", "status" "text", "scopes" "text"[], "accepted_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not exists (
    select 1 from practitioners pr
    where pr.user_id = auth.uid() and pr.verified_at is not null
  ) then
    return;
  end if;

  return query
  select cr.id, cr.client_id, p.username, cr.status, cr.scopes, cr.accepted_at
  from care_relationships cr
  join profiles p on p.id = cr.client_id
  where cr.practitioner_id = auth.uid()
    and cr.status in ('invited', 'active')
  order by cr.accepted_at desc nulls last, cr.invited_at desc;
end;
$$;


ALTER FUNCTION "public"."practitioner_list_clients"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_practitioner_self_verification"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if auth.uid() = old.user_id then
    new.verified_at := old.verified_at;
    new.verified_by := old.verified_by;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."prevent_practitioner_self_verification"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."revoke_care_access"("p_relationship_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update care_relationships
  set status = 'revoked', revoked_at = now()
  where id = p_relationship_id
    and client_id = auth.uid()
    and status in ('invited', 'active');

  if not found then
    raise exception 'Relationship not found or already revoked';
  end if;
end;
$$;


ALTER FUNCTION "public"."revoke_care_access"("p_relationship_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_care_relationship_scopes"("p_relationship_id" "uuid", "p_scopes" "text"[]) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update care_relationships
  set scopes = p_scopes
  where id = p_relationship_id
    and client_id = auth.uid()
    and status = 'active';

  if not found then
    raise exception 'Relationship not found or not active';
  end if;
end;
$$;


ALTER FUNCTION "public"."update_care_relationship_scopes"("p_relationship_id" "uuid", "p_scopes" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."admin_audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "actor_id" "uuid" NOT NULL,
    "action" "text" NOT NULL,
    "target_id" "uuid",
    "details" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."admin_audit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."brands" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "aliases" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."brands" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."care_relationships" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "practitioner_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "status" "text" NOT NULL,
    "scopes" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "invited_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "accepted_at" timestamp with time zone,
    "revoked_at" timestamp with time zone,
    "last_active_at" timestamp with time zone,
    CONSTRAINT "care_relationships_check" CHECK (("practitioner_id" <> "client_id")),
    CONSTRAINT "care_relationships_scopes_check" CHECK (("scopes" <@ ARRAY['skin_profile'::"text", 'routine'::"text", 'daily_logs'::"text", 'photos'::"text"])),
    CONSTRAINT "care_relationships_status_check" CHECK (("status" = ANY (ARRAY['invited'::"text", 'active'::"text", 'revoked'::"text"])))
);


ALTER TABLE "public"."care_relationships" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."diary_nudge_log" (
    "user_id" "uuid" NOT NULL,
    "local_date" "date" NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."diary_nudge_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."inactivity_nudge_log" (
    "user_id" "uuid" NOT NULL,
    "days_inactive" integer NOT NULL,
    "last_completed_snapshot" "date" NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "inactivity_nudge_log_days_inactive_check" CHECK (("days_inactive" = ANY (ARRAY[3, 7])))
);


ALTER TABLE "public"."inactivity_nudge_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invitations" (
    "token" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "practitioner_id" "uuid" NOT NULL,
    "invited_email" "text",
    "invited_phone" "text",
    "scopes" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '14 days'::interval) NOT NULL,
    "used_at" timestamp with time zone,
    "used_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "invitations_check" CHECK ((("invited_email" IS NOT NULL) OR ("invited_phone" IS NOT NULL))),
    CONSTRAINT "invitations_scopes_check" CHECK (("scopes" <@ ARRAY['skin_profile'::"text", 'routine'::"text", 'daily_logs'::"text", 'photos'::"text"]))
);


ALTER TABLE "public"."invitations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."onboarding_nudge_log" (
    "user_id" "uuid" NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."onboarding_nudge_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."practitioner_access_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "practitioner_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "what" "text" NOT NULL,
    "at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."practitioner_access_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."practitioners" (
    "user_id" "uuid" NOT NULL,
    "display_name" "text" NOT NULL,
    "bio" "text",
    "specialisms" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "instagram" "text",
    "whatsapp" "text",
    "verified_at" timestamp with time zone,
    "verified_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."practitioners" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."products" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand" "text" NOT NULL,
    "name" "text" NOT NULL,
    "category" "text" NOT NULL,
    "image_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "barcode" "text",
    "ingredients" "text",
    "source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "pao_hint" integer,
    "brand_id" "uuid",
    CONSTRAINT "products_pao_hint_check" CHECK ((("pao_hint" IS NULL) OR (("pao_hint" >= 1) AND ("pao_hint" <= 60)))),
    CONSTRAINT "products_source_check" CHECK (("source" = ANY (ARRAY['manual'::"text", 'openbeautyfacts'::"text"])))
);


ALTER TABLE "public"."products" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "username" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "onboarding_completed" boolean DEFAULT false,
    CONSTRAINT "profiles_username_length" CHECK ((("username" IS NULL) OR (("char_length"("username") >= 2) AND ("char_length"("username") <= 30)))),
    CONSTRAINT "profiles_username_trimmed" CHECK ((("username" IS NULL) OR ("username" = TRIM(BOTH FROM "username"))))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."progress_photos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "path" "text" NOT NULL,
    "local_date" "date" NOT NULL,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "progress_photos_path_owned" CHECK (("path" ~~ (("user_id")::"text" || '/%'::"text")))
);


ALTER TABLE "public"."progress_photos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."push_subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "subscription" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."push_subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."recommendation_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "recommendation_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "slot" "text" NOT NULL,
    "frequency" "text" DEFAULT 'daily'::"text" NOT NULL,
    "reason" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "days_of_week" smallint[] DEFAULT '{0,1,2,3,4,5,6}'::smallint[] NOT NULL,
    CONSTRAINT "recommendation_items_days_of_week_check" CHECK (((("array_length"("days_of_week", 1) >= 1) AND ("array_length"("days_of_week", 1) <= 7)) AND ("days_of_week" <@ ARRAY[(0)::smallint, (1)::smallint, (2)::smallint, (3)::smallint, (4)::smallint, (5)::smallint, (6)::smallint]))),
    CONSTRAINT "recommendation_items_slot_check" CHECK (("slot" = ANY (ARRAY['AM'::"text", 'PM'::"text"])))
);


ALTER TABLE "public"."recommendation_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."recommendations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "practitioner_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'proposed'::"text" NOT NULL,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "responded_at" timestamp with time zone,
    "proposes_skin_profile" boolean DEFAULT false NOT NULL,
    "gender" "text",
    "skin_type" "text",
    "concerns" "text",
    "goals" "text",
    "sensitivity" "text",
    "pregnant_or_breastfeeding" boolean,
    CONSTRAINT "recommendations_status_check" CHECK (("status" = ANY (ARRAY['proposed'::"text", 'accepted'::"text", 'declined'::"text", 'superseded'::"text"])))
);


ALTER TABLE "public"."recommendations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reminder_followup_log" (
    "user_id" "uuid" NOT NULL,
    "slot" "text" NOT NULL,
    "local_date" "date" NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "reminder_followup_log_slot_check" CHECK (("slot" = ANY (ARRAY['morning'::"text", 'night'::"text"])))
);


ALTER TABLE "public"."reminder_followup_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reminder_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "slot" "text" NOT NULL,
    "local_date" "date" NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "reminder_log_slot_check" CHECK (("slot" = ANY (ARRAY['morning'::"text", 'night'::"text"])))
);


ALTER TABLE "public"."reminder_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reminder_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "morning_enabled" boolean DEFAULT true,
    "morning_time" time without time zone DEFAULT '07:00:00'::time without time zone,
    "night_enabled" boolean DEFAULT true,
    "night_time" time without time zone DEFAULT '21:00:00'::time without time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "timezone" "text" DEFAULT 'Africa/Lagos'::"text" NOT NULL,
    "spf_reapply_enabled" boolean DEFAULT false NOT NULL,
    "diary_nudge_enabled" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."reminder_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."routine_completions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "completed_date" "date" NOT NULL,
    "completed_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."routine_completions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."routine_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "routine_id" "uuid",
    "log_date" "date",
    "status" "text" DEFAULT 'scheduled'::"text",
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."routine_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."routine_schedule" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "routine_step_id" "uuid",
    "scheduled_date" "date" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."routine_schedule" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."routine_step_completions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "routine_step_id" "uuid",
    "completed_at" timestamp with time zone DEFAULT "now"(),
    "local_date" "date" DEFAULT (("now"() AT TIME ZONE 'Africa/Lagos'::"text"))::"date" NOT NULL
);


ALTER TABLE "public"."routine_step_completions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."routine_step_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "routine_log_id" "uuid",
    "routine_step_id" "uuid",
    "product_name_snapshot" "text",
    "brand_snapshot" "text",
    "step_order_snapshot" integer,
    "completed" boolean DEFAULT false,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."routine_step_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."routine_steps" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "routine_id" "uuid" NOT NULL,
    "user_product_id" "uuid" NOT NULL,
    "step_order" integer NOT NULL,
    "step_name" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "frequency" "text" DEFAULT 'daily'::"text" NOT NULL,
    "days_of_week" smallint[] DEFAULT '{0,1,2,3,4,5,6}'::smallint[] NOT NULL,
    CONSTRAINT "routine_steps_days_of_week_check" CHECK (((("array_length"("days_of_week", 1) >= 1) AND ("array_length"("days_of_week", 1) <= 7)) AND ("days_of_week" <@ ARRAY[(0)::smallint, (1)::smallint, (2)::smallint, (3)::smallint, (4)::smallint, (5)::smallint, (6)::smallint]))),
    CONSTRAINT "routine_steps_frequency_check" CHECK (("frequency" = ANY (ARRAY['daily'::"text", 'alternate'::"text", 'every3'::"text", 'twice_week'::"text", 'once_week'::"text"])))
);


ALTER TABLE "public"."routine_steps" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."routines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "time_of_day" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "routine_code" "text"
);


ALTER TABLE "public"."routines" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."skin_checkins" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "gen_random_uuid"(),
    "checkin_date" "date",
    "skin_feel" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."skin_checkins" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."skin_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "local_date" "date" NOT NULL,
    "breakouts" integer DEFAULT 0 NOT NULL,
    "dryness" integer DEFAULT 0 NOT NULL,
    "oiliness" integer DEFAULT 0 NOT NULL,
    "redness" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "note" "text",
    CONSTRAINT "skin_logs_scores_check" CHECK (((("breakouts" >= 0) AND ("breakouts" <= 10)) AND (("dryness" >= 0) AND ("dryness" <= 10)) AND (("oiliness" >= 0) AND ("oiliness" <= 10)) AND (("redness" >= 0) AND ("redness" <= 10))))
);


ALTER TABLE "public"."skin_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."skin_profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "skin_type" "text",
    "concerns" "text",
    "goals" "text",
    "sensitivity" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "gender" "text",
    "pregnant_or_breastfeeding" boolean
);


ALTER TABLE "public"."skin_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."spf_reminder_log" (
    "user_id" "uuid" NOT NULL,
    "local_date" "date" NOT NULL,
    "reapply_number" integer NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."spf_reminder_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."storage_cleanup_queue" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bucket_id" "text" NOT NULL,
    "path" "text" NOT NULL,
    "reason" "text" NOT NULL,
    "queued_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."storage_cleanup_queue" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_products" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "notes" "text" DEFAULT 'true'::"text",
    "added_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_active" boolean NOT NULL,
    "opened_date" "date",
    "pao_months" integer,
    "expiry_date" "date",
    CONSTRAINT "user_products_expiry_date_check" CHECK ((("expiry_date" IS NULL) OR (("expiry_date" >= '2000-01-01'::"date") AND ("expiry_date" <= (((("now"() AT TIME ZONE 'Africa/Lagos'::"text"))::"date" + '20 years'::interval))::"date")))),
    CONSTRAINT "user_products_opened_date_check" CHECK ((("opened_date" IS NULL) OR ("opened_date" <= ((("now"() AT TIME ZONE 'Africa/Lagos'::"text"))::"date" + 1)))),
    CONSTRAINT "user_products_pao_months_check" CHECK ((("pao_months" IS NULL) OR (("pao_months" >= 1) AND ("pao_months" <= 60))))
);


ALTER TABLE "public"."user_products" OWNER TO "postgres";


ALTER TABLE ONLY "public"."admin_audit_log"
    ADD CONSTRAINT "admin_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."brands"
    ADD CONSTRAINT "brands_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."care_relationships"
    ADD CONSTRAINT "care_relationships_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."diary_nudge_log"
    ADD CONSTRAINT "diary_nudge_log_pkey" PRIMARY KEY ("user_id", "local_date");



ALTER TABLE ONLY "public"."inactivity_nudge_log"
    ADD CONSTRAINT "inactivity_nudge_log_pkey" PRIMARY KEY ("user_id", "days_inactive", "last_completed_snapshot");



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_pkey" PRIMARY KEY ("token");



ALTER TABLE ONLY "public"."onboarding_nudge_log"
    ADD CONSTRAINT "onboarding_nudge_log_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."practitioner_access_log"
    ADD CONSTRAINT "practitioner_access_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."practitioners"
    ADD CONSTRAINT "practitioners_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_barcode_key" UNIQUE ("barcode");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_id_unique" UNIQUE ("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_pkey" PRIMARY KEY ("id", "brand", "name", "category", "created_at");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."progress_photos"
    ADD CONSTRAINT "progress_photos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."recommendation_items"
    ADD CONSTRAINT "recommendation_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."recommendations"
    ADD CONSTRAINT "recommendations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reminder_followup_log"
    ADD CONSTRAINT "reminder_followup_log_pkey" PRIMARY KEY ("user_id", "slot", "local_date");



ALTER TABLE ONLY "public"."reminder_log"
    ADD CONSTRAINT "reminder_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reminder_log"
    ADD CONSTRAINT "reminder_log_user_id_slot_local_date_key" UNIQUE ("user_id", "slot", "local_date");



ALTER TABLE ONLY "public"."reminder_settings"
    ADD CONSTRAINT "reminder_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reminder_settings"
    ADD CONSTRAINT "reminder_settings_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."routine_completions"
    ADD CONSTRAINT "routine_completions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."routine_completions"
    ADD CONSTRAINT "routine_completions_user_id_completed_date_key" UNIQUE ("user_id", "completed_date");



ALTER TABLE ONLY "public"."routine_logs"
    ADD CONSTRAINT "routine_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."routine_logs"
    ADD CONSTRAINT "routine_logs_routine_date_unique" UNIQUE ("routine_id", "log_date");



ALTER TABLE ONLY "public"."routine_schedule"
    ADD CONSTRAINT "routine_schedule_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."routine_step_completions"
    ADD CONSTRAINT "routine_step_completions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."routine_step_completions"
    ADD CONSTRAINT "routine_step_completions_user_step_day_key" UNIQUE ("user_id", "routine_step_id", "local_date");



ALTER TABLE ONLY "public"."routine_step_logs"
    ADD CONSTRAINT "routine_step_logs_log_step_unique" UNIQUE ("routine_log_id", "routine_step_id");



ALTER TABLE ONLY "public"."routine_step_logs"
    ADD CONSTRAINT "routine_step_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."routine_steps"
    ADD CONSTRAINT "routine_steps_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."routines"
    ADD CONSTRAINT "routines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."skin_checkins"
    ADD CONSTRAINT "skin_checkins_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."skin_logs"
    ADD CONSTRAINT "skin_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."skin_logs"
    ADD CONSTRAINT "skin_logs_user_id_local_date_key" UNIQUE ("user_id", "local_date");



ALTER TABLE ONLY "public"."skin_profiles"
    ADD CONSTRAINT "skin_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."skin_profiles"
    ADD CONSTRAINT "skin_profiles_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."spf_reminder_log"
    ADD CONSTRAINT "spf_reminder_log_pkey" PRIMARY KEY ("user_id", "local_date", "reapply_number");



ALTER TABLE ONLY "public"."storage_cleanup_queue"
    ADD CONSTRAINT "storage_cleanup_queue_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_products"
    ADD CONSTRAINT "user_products_pkey" PRIMARY KEY ("id");



CREATE UNIQUE INDEX "brands_name_lower_key" ON "public"."brands" USING "btree" ("lower"("name"));



CREATE UNIQUE INDEX "care_relationships_live_pair_idx" ON "public"."care_relationships" USING "btree" ("practitioner_id", "client_id") WHERE ("status" = ANY (ARRAY['invited'::"text", 'active'::"text"]));



CREATE UNIQUE INDEX "profiles_username_lower_key" ON "public"."profiles" USING "btree" ("lower"("username")) WHERE ("username" IS NOT NULL);



CREATE INDEX "routine_step_completions_user_day_idx" ON "public"."routine_step_completions" USING "btree" ("user_id", "local_date");



CREATE UNIQUE INDEX "routines_one_active_per_slot" ON "public"."routines" USING "btree" ("user_id", "time_of_day") WHERE "is_active";



CREATE INDEX "storage_cleanup_queue_pending_idx" ON "public"."storage_cleanup_queue" USING "btree" ("queued_at") WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "user_products_active_unique" ON "public"."user_products" USING "btree" ("user_id", "product_id") WHERE ("is_active" = true);



CREATE OR REPLACE TRIGGER "practitioners_prevent_self_verification" BEFORE UPDATE ON "public"."practitioners" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_practitioner_self_verification"();



CREATE OR REPLACE TRIGGER "recommendations_lock_fields" BEFORE UPDATE ON "public"."recommendations" FOR EACH ROW EXECUTE FUNCTION "public"."lock_recommendation_fields"();



CREATE OR REPLACE TRIGGER "set_skin_profiles_updated_at" BEFORE UPDATE ON "public"."skin_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."care_relationships"
    ADD CONSTRAINT "care_relationships_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."care_relationships"
    ADD CONSTRAINT "care_relationships_practitioner_id_fkey" FOREIGN KEY ("practitioner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."diary_nudge_log"
    ADD CONSTRAINT "diary_nudge_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."inactivity_nudge_log"
    ADD CONSTRAINT "inactivity_nudge_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_practitioner_id_fkey" FOREIGN KEY ("practitioner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_used_by_fkey" FOREIGN KEY ("used_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."onboarding_nudge_log"
    ADD CONSTRAINT "onboarding_nudge_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."practitioner_access_log"
    ADD CONSTRAINT "practitioner_access_log_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."practitioner_access_log"
    ADD CONSTRAINT "practitioner_access_log_practitioner_id_fkey" FOREIGN KEY ("practitioner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."practitioners"
    ADD CONSTRAINT "practitioners_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."practitioners"
    ADD CONSTRAINT "practitioners_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."progress_photos"
    ADD CONSTRAINT "progress_photos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."recommendation_items"
    ADD CONSTRAINT "recommendation_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id");



ALTER TABLE ONLY "public"."recommendation_items"
    ADD CONSTRAINT "recommendation_items_recommendation_id_fkey" FOREIGN KEY ("recommendation_id") REFERENCES "public"."recommendations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."recommendations"
    ADD CONSTRAINT "recommendations_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."recommendations"
    ADD CONSTRAINT "recommendations_practitioner_id_fkey" FOREIGN KEY ("practitioner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reminder_followup_log"
    ADD CONSTRAINT "reminder_followup_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reminder_log"
    ADD CONSTRAINT "reminder_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reminder_settings"
    ADD CONSTRAINT "reminder_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."routine_completions"
    ADD CONSTRAINT "routine_completions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."routine_logs"
    ADD CONSTRAINT "routine_logs_routine_id_fkey" FOREIGN KEY ("routine_id") REFERENCES "public"."routines"("id") ON UPDATE CASCADE;



ALTER TABLE ONLY "public"."routine_logs"
    ADD CONSTRAINT "routine_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."routine_schedule"
    ADD CONSTRAINT "routine_schedule_routine_step_id_fkey" FOREIGN KEY ("routine_step_id") REFERENCES "public"."routine_steps"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."routine_schedule"
    ADD CONSTRAINT "routine_schedule_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."routine_step_completions"
    ADD CONSTRAINT "routine_step_completions_routine_step_id_fkey" FOREIGN KEY ("routine_step_id") REFERENCES "public"."routine_steps"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."routine_step_completions"
    ADD CONSTRAINT "routine_step_completions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."routine_step_logs"
    ADD CONSTRAINT "routine_step_logs_routine_log_id_fkey" FOREIGN KEY ("routine_log_id") REFERENCES "public"."routine_logs"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."routine_step_logs"
    ADD CONSTRAINT "routine_step_logs_routine_step_id_fkey" FOREIGN KEY ("routine_step_id") REFERENCES "public"."routine_steps"("id") ON UPDATE CASCADE;



ALTER TABLE ONLY "public"."routine_steps"
    ADD CONSTRAINT "routine_steps_routine_id_fkey" FOREIGN KEY ("routine_id") REFERENCES "public"."routines"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."routine_steps"
    ADD CONSTRAINT "routine_steps_user_product_id_fkey" FOREIGN KEY ("user_product_id") REFERENCES "public"."user_products"("id") ON UPDATE CASCADE;



ALTER TABLE ONLY "public"."routines"
    ADD CONSTRAINT "routines_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."skin_checkins"
    ADD CONSTRAINT "skin_checkins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."skin_logs"
    ADD CONSTRAINT "skin_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."spf_reminder_log"
    ADD CONSTRAINT "spf_reminder_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_products"
    ADD CONSTRAINT "user_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON UPDATE CASCADE;



ALTER TABLE ONLY "public"."user_products"
    ADD CONSTRAINT "user_products_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON UPDATE CASCADE ON DELETE CASCADE;



CREATE POLICY "Anyone signed in can view practitioner profiles" ON "public"."practitioners" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can create products" ON "public"."products" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Authenticated users can view products" ON "public"."products" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Clients can respond to recommendations" ON "public"."recommendations" FOR UPDATE USING (("auth"."uid"() = "client_id")) WITH CHECK (("auth"."uid"() = "client_id"));



CREATE POLICY "Clients can see who accessed their data" ON "public"."practitioner_access_log" FOR SELECT USING (("auth"."uid"() = "client_id"));



CREATE POLICY "Clients see recommendations made to them" ON "public"."recommendations" FOR SELECT USING (("auth"."uid"() = "client_id"));



CREATE POLICY "Clients see their own relationships" ON "public"."care_relationships" FOR SELECT USING (("auth"."uid"() = "client_id"));



CREATE POLICY "Practitioners can add items to their own recommendations" ON "public"."recommendation_items" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."recommendations" "r"
  WHERE (("r"."id" = "recommendation_items"."recommendation_id") AND ("r"."practitioner_id" = "auth"."uid"()) AND ("r"."status" = 'proposed'::"text")))));



CREATE POLICY "Practitioners can cancel their own unused invitations" ON "public"."invitations" FOR DELETE USING ((("auth"."uid"() = "practitioner_id") AND ("used_at" IS NULL)));



CREATE POLICY "Practitioners can create invitations" ON "public"."invitations" FOR INSERT WITH CHECK ((("auth"."uid"() = "practitioner_id") AND (EXISTS ( SELECT 1
   FROM "public"."practitioners" "pr"
  WHERE (("pr"."user_id" = "auth"."uid"()) AND ("pr"."verified_at" IS NOT NULL))))));



CREATE POLICY "Practitioners can edit items on their own proposed recommendati" ON "public"."recommendation_items" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."recommendations" "r"
  WHERE (("r"."id" = "recommendation_items"."recommendation_id") AND ("r"."practitioner_id" = "auth"."uid"()) AND ("r"."status" = 'proposed'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."recommendations" "r"
  WHERE (("r"."id" = "recommendation_items"."recommendation_id") AND ("r"."practitioner_id" = "auth"."uid"()) AND ("r"."status" = 'proposed'::"text")))));



CREATE POLICY "Practitioners can invite existing clients" ON "public"."care_relationships" FOR INSERT WITH CHECK ((("auth"."uid"() = "practitioner_id") AND ("status" = 'invited'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."practitioners" "pr"
  WHERE (("pr"."user_id" = "auth"."uid"()) AND ("pr"."verified_at" IS NOT NULL))))));



CREATE POLICY "Practitioners can propose recommendations" ON "public"."recommendations" FOR INSERT WITH CHECK ((("auth"."uid"() = "practitioner_id") AND ("status" = 'proposed'::"text") AND ( SELECT "public"."has_client_access"("recommendations"."client_id", 'routine'::"text") AS "has_client_access")));



CREATE POLICY "Practitioners can remove items from their own proposed recommen" ON "public"."recommendation_items" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."recommendations" "r"
  WHERE (("r"."id" = "recommendation_items"."recommendation_id") AND ("r"."practitioner_id" = "auth"."uid"()) AND ("r"."status" = 'proposed'::"text")))));



CREATE POLICY "Practitioners can see their own access history" ON "public"."practitioner_access_log" FOR SELECT USING (("auth"."uid"() = "practitioner_id"));



CREATE POLICY "Practitioners can update their own profile" ON "public"."practitioners" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Practitioners can withdraw their own proposed recommendations" ON "public"."recommendations" FOR UPDATE USING ((("auth"."uid"() = "practitioner_id") AND ("status" = 'proposed'::"text"))) WITH CHECK (("auth"."uid"() = "practitioner_id"));



CREATE POLICY "Practitioners see their own invitations" ON "public"."invitations" FOR SELECT USING (("auth"."uid"() = "practitioner_id"));



CREATE POLICY "Practitioners see their own recommendations" ON "public"."recommendations" FOR SELECT USING (("auth"."uid"() = "practitioner_id"));



CREATE POLICY "Practitioners see their own relationships" ON "public"."care_relationships" FOR SELECT USING (("auth"."uid"() = "practitioner_id"));



CREATE POLICY "Practitioners with daily_logs scope can view completions" ON "public"."routine_step_completions" FOR SELECT USING (( SELECT "public"."has_client_access"("routine_step_completions"."user_id", 'daily_logs'::"text") AS "has_client_access"));



CREATE POLICY "Practitioners with daily_logs scope can view routine completion" ON "public"."routine_completions" FOR SELECT USING (( SELECT "public"."has_client_access"("routine_completions"."user_id", 'daily_logs'::"text") AS "has_client_access"));



CREATE POLICY "Practitioners with routine scope can view routine steps" ON "public"."routine_steps" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."routines" "r"
  WHERE (("r"."id" = "routine_steps"."routine_id") AND ( SELECT "public"."has_client_access"("r"."user_id", 'routine'::"text") AS "has_client_access")))));



CREATE POLICY "Practitioners with routine scope can view routines" ON "public"."routines" FOR SELECT USING (( SELECT "public"."has_client_access"("routines"."user_id", 'routine'::"text") AS "has_client_access"));



CREATE POLICY "Practitioners with routine scope can view user products" ON "public"."user_products" FOR SELECT USING (( SELECT "public"."has_client_access"("user_products"."user_id", 'routine'::"text") AS "has_client_access"));



CREATE POLICY "Practitioners with skin_profile scope can view" ON "public"."skin_profiles" FOR SELECT USING (( SELECT "public"."has_client_access"("skin_profiles"."user_id", 'skin_profile'::"text") AS "has_client_access"));



CREATE POLICY "Recommendation items follow their recommendation" ON "public"."recommendation_items" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."recommendations" "r"
  WHERE (("r"."id" = "recommendation_items"."recommendation_id") AND (("r"."practitioner_id" = "auth"."uid"()) OR ("r"."client_id" = "auth"."uid"()))))));



CREATE POLICY "Signed-in users can read brands" ON "public"."brands" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Users can add their own products" ON "public"."user_products" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can create their own completions" ON "public"."routine_step_completions" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can create their own practitioner profile" ON "public"."practitioners" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can create their own profile" ON "public"."profiles" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users can create their own push subscription" ON "public"."push_subscriptions" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can create their own reminder settings" ON "public"."reminder_settings" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can create their own routine completions" ON "public"."routine_completions" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can create their own routine logs" ON "public"."routine_logs" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can create their own routine schedule" ON "public"."routine_schedule" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can create their own routine step logs" ON "public"."routine_step_logs" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."routine_logs" "rl"
  WHERE (("rl"."id" = "routine_step_logs"."routine_log_id") AND ("rl"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can create their own routine steps" ON "public"."routine_steps" FOR INSERT WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."routines" "r"
  WHERE (("r"."id" = "routine_steps"."routine_id") AND ("r"."user_id" = "auth"."uid"())))) AND (EXISTS ( SELECT 1
   FROM "public"."user_products" "up"
  WHERE (("up"."id" = "routine_steps"."user_product_id") AND ("up"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Users can create their own routines" ON "public"."routines" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can create their own skin checkins" ON "public"."skin_checkins" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can create their own skin profile" ON "public"."skin_profiles" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can delete their own push subscription" ON "public"."push_subscriptions" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete their own reminder settings" ON "public"."reminder_settings" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete their own routine completions" ON "public"."routine_completions" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete their own routine logs" ON "public"."routine_logs" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can delete their own routine step logs" ON "public"."routine_step_logs" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."routine_logs" "rl"
  WHERE (("rl"."id" = "routine_step_logs"."routine_log_id") AND ("rl"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can delete their own routine steps" ON "public"."routine_steps" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."routines" "r"
  WHERE (("r"."id" = "routine_steps"."routine_id") AND ("r"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can delete their own routines" ON "public"."routines" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can delete their own skin checkins" ON "public"."skin_checkins" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can delete their own skin profile" ON "public"."skin_profiles" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can delete today's own completions" ON "public"."routine_step_completions" FOR DELETE USING ((("auth"."uid"() = "user_id") AND ("local_date" >= ((("now"() AT TIME ZONE 'Africa/Lagos'::"text"))::"date" - 1)) AND ("local_date" <= (("now"() AT TIME ZONE 'Africa/Lagos'::"text"))::"date")));



CREATE POLICY "Users can remove their own products" ON "public"."user_products" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can see their own reminder history" ON "public"."reminder_log" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own products" ON "public"."user_products" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can update their own profile" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id")) WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users can update their own push subscription" ON "public"."push_subscriptions" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own reminder settings" ON "public"."reminder_settings" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own routine completions" ON "public"."routine_completions" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own routine logs" ON "public"."routine_logs" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can update their own routine step logs" ON "public"."routine_step_logs" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."routine_logs" "rl"
  WHERE (("rl"."id" = "routine_step_logs"."routine_log_id") AND ("rl"."user_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."routine_logs" "rl"
  WHERE (("rl"."id" = "routine_step_logs"."routine_log_id") AND ("rl"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can update their own routine steps" ON "public"."routine_steps" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."routines" "r"
  WHERE (("r"."id" = "routine_steps"."routine_id") AND ("r"."user_id" = "auth"."uid"()))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."routines" "r"
  WHERE (("r"."id" = "routine_steps"."routine_id") AND ("r"."user_id" = "auth"."uid"())))) AND (EXISTS ( SELECT 1
   FROM "public"."user_products" "up"
  WHERE (("up"."id" = "routine_steps"."user_product_id") AND ("up"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Users can update their own routines" ON "public"."routines" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can update their own skin checkins" ON "public"."skin_checkins" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can update their own skin profile" ON "public"."skin_profiles" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can view their own completions" ON "public"."routine_step_completions" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own products" ON "public"."user_products" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can view their own profile" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can view their own push subscription" ON "public"."push_subscriptions" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own reminder settings" ON "public"."reminder_settings" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own routine completions" ON "public"."routine_completions" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own routine logs" ON "public"."routine_logs" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can view their own routine step logs" ON "public"."routine_step_logs" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."routine_logs" "rl"
  WHERE (("rl"."id" = "routine_step_logs"."routine_log_id") AND ("rl"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view their own routine steps" ON "public"."routine_steps" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."routines" "r"
  WHERE (("r"."id" = "routine_steps"."routine_id") AND ("r"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view their own routines" ON "public"."routines" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can view their own skin checkins" ON "public"."skin_checkins" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can view their own skin profile" ON "public"."skin_profiles" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users manage their own progress photos" ON "public"."progress_photos" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage their own skin log" ON "public"."skin_logs" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."admin_audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."brands" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."care_relationships" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."diary_nudge_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."inactivity_nudge_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invitations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."onboarding_nudge_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."practitioner_access_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."practitioners" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."products" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."progress_photos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."push_subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."recommendation_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."recommendations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reminder_followup_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reminder_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reminder_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."routine_completions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."routine_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."routine_schedule" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."routine_step_completions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."routine_step_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."routine_steps" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."routines" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."skin_checkins" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."skin_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."skin_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."spf_reminder_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."storage_cleanup_queue" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_products" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "public"."accept_care_relationship"("p_relationship_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."accept_care_relationship"("p_relationship_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."accept_care_relationship"("p_relationship_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."accept_invitation"("p_token" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."accept_invitation"("p_token" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."accept_invitation"("p_token" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."accept_recommendation"("p_recommendation_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."accept_recommendation"("p_recommendation_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."accept_recommendation"("p_recommendation_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_delete_user"("target_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_delete_user"("target_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_delete_user"("target_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_list_pending_practitioners"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_list_pending_practitioners"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_list_pending_practitioners"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_list_users"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_list_users"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_list_users"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_review_practitioner"("target_id" "uuid", "approve" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_review_practitioner"("target_id" "uuid", "approve" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_review_practitioner"("target_id" "uuid", "approve" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_suspend_user"("target_id" "uuid", "suspend" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_suspend_user"("target_id" "uuid", "suspend" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_suspend_user"("target_id" "uuid", "suspend" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_routine"("p_routine_code" "text", "p_am_steps" "jsonb", "p_pm_steps" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_routine"("p_routine_code" "text", "p_am_steps" "jsonb", "p_pm_steps" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_routine"("p_routine_code" "text", "p_am_steps" "jsonb", "p_pm_steps" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."due_diary_nudges"("window_minutes" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."due_diary_nudges"("window_minutes" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."due_followups"("window_minutes" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."due_followups"("window_minutes" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."due_inactivity_nudges"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."due_inactivity_nudges"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."due_onboarding_nudges"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."due_onboarding_nudges"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."due_reminders"("window_minutes" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."due_reminders"("window_minutes" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."due_spf_reminders"("window_minutes" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."due_spf_reminders"("window_minutes" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."has_client_access"("p_client" "uuid", "p_scope" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."has_client_access"("p_client" "uuid", "p_scope" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_client_access"("p_client" "uuid", "p_scope" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."lock_recommendation_fields"() TO "anon";
GRANT ALL ON FUNCTION "public"."lock_recommendation_fields"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."lock_recommendation_fields"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."practitioner_get_client_profile"("p_client" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."practitioner_get_client_profile"("p_client" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."practitioner_get_client_profile"("p_client" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."practitioner_invite_by_email"("p_email" "text", "p_scopes" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."practitioner_invite_by_email"("p_email" "text", "p_scopes" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."practitioner_invite_by_email"("p_email" "text", "p_scopes" "text"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."practitioner_list_clients"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."practitioner_list_clients"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."practitioner_list_clients"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_practitioner_self_verification"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_practitioner_self_verification"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_practitioner_self_verification"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."revoke_care_access"("p_relationship_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."revoke_care_access"("p_relationship_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."revoke_care_access"("p_relationship_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_care_relationship_scopes"("p_relationship_id" "uuid", "p_scopes" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_care_relationship_scopes"("p_relationship_id" "uuid", "p_scopes" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_care_relationship_scopes"("p_relationship_id" "uuid", "p_scopes" "text"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



GRANT ALL ON TABLE "public"."admin_audit_log" TO "anon";
GRANT ALL ON TABLE "public"."admin_audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_audit_log" TO "service_role";



GRANT ALL ON TABLE "public"."brands" TO "anon";
GRANT ALL ON TABLE "public"."brands" TO "authenticated";
GRANT ALL ON TABLE "public"."brands" TO "service_role";



GRANT ALL ON TABLE "public"."care_relationships" TO "anon";
GRANT ALL ON TABLE "public"."care_relationships" TO "authenticated";
GRANT ALL ON TABLE "public"."care_relationships" TO "service_role";



GRANT ALL ON TABLE "public"."diary_nudge_log" TO "anon";
GRANT ALL ON TABLE "public"."diary_nudge_log" TO "authenticated";
GRANT ALL ON TABLE "public"."diary_nudge_log" TO "service_role";



GRANT ALL ON TABLE "public"."inactivity_nudge_log" TO "anon";
GRANT ALL ON TABLE "public"."inactivity_nudge_log" TO "authenticated";
GRANT ALL ON TABLE "public"."inactivity_nudge_log" TO "service_role";



GRANT ALL ON TABLE "public"."invitations" TO "anon";
GRANT ALL ON TABLE "public"."invitations" TO "authenticated";
GRANT ALL ON TABLE "public"."invitations" TO "service_role";



GRANT ALL ON TABLE "public"."onboarding_nudge_log" TO "anon";
GRANT ALL ON TABLE "public"."onboarding_nudge_log" TO "authenticated";
GRANT ALL ON TABLE "public"."onboarding_nudge_log" TO "service_role";



GRANT ALL ON TABLE "public"."practitioner_access_log" TO "anon";
GRANT ALL ON TABLE "public"."practitioner_access_log" TO "authenticated";
GRANT ALL ON TABLE "public"."practitioner_access_log" TO "service_role";



GRANT ALL ON TABLE "public"."practitioners" TO "anon";
GRANT ALL ON TABLE "public"."practitioners" TO "authenticated";
GRANT ALL ON TABLE "public"."practitioners" TO "service_role";



GRANT ALL ON TABLE "public"."products" TO "anon";
GRANT ALL ON TABLE "public"."products" TO "authenticated";
GRANT ALL ON TABLE "public"."products" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."progress_photos" TO "anon";
GRANT ALL ON TABLE "public"."progress_photos" TO "authenticated";
GRANT ALL ON TABLE "public"."progress_photos" TO "service_role";



GRANT ALL ON TABLE "public"."push_subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."recommendation_items" TO "anon";
GRANT ALL ON TABLE "public"."recommendation_items" TO "authenticated";
GRANT ALL ON TABLE "public"."recommendation_items" TO "service_role";



GRANT ALL ON TABLE "public"."recommendations" TO "anon";
GRANT ALL ON TABLE "public"."recommendations" TO "authenticated";
GRANT ALL ON TABLE "public"."recommendations" TO "service_role";



GRANT ALL ON TABLE "public"."reminder_followup_log" TO "anon";
GRANT ALL ON TABLE "public"."reminder_followup_log" TO "authenticated";
GRANT ALL ON TABLE "public"."reminder_followup_log" TO "service_role";



GRANT ALL ON TABLE "public"."reminder_log" TO "anon";
GRANT ALL ON TABLE "public"."reminder_log" TO "authenticated";
GRANT ALL ON TABLE "public"."reminder_log" TO "service_role";



GRANT ALL ON TABLE "public"."reminder_settings" TO "anon";
GRANT ALL ON TABLE "public"."reminder_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."reminder_settings" TO "service_role";



GRANT ALL ON TABLE "public"."routine_completions" TO "anon";
GRANT ALL ON TABLE "public"."routine_completions" TO "authenticated";
GRANT ALL ON TABLE "public"."routine_completions" TO "service_role";



GRANT ALL ON TABLE "public"."routine_logs" TO "anon";
GRANT ALL ON TABLE "public"."routine_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."routine_logs" TO "service_role";



GRANT ALL ON TABLE "public"."routine_schedule" TO "anon";
GRANT ALL ON TABLE "public"."routine_schedule" TO "authenticated";
GRANT ALL ON TABLE "public"."routine_schedule" TO "service_role";



GRANT ALL ON TABLE "public"."routine_step_completions" TO "anon";
GRANT ALL ON TABLE "public"."routine_step_completions" TO "authenticated";
GRANT ALL ON TABLE "public"."routine_step_completions" TO "service_role";



GRANT ALL ON TABLE "public"."routine_step_logs" TO "anon";
GRANT ALL ON TABLE "public"."routine_step_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."routine_step_logs" TO "service_role";



GRANT ALL ON TABLE "public"."routine_steps" TO "anon";
GRANT ALL ON TABLE "public"."routine_steps" TO "authenticated";
GRANT ALL ON TABLE "public"."routine_steps" TO "service_role";



GRANT ALL ON TABLE "public"."routines" TO "anon";
GRANT ALL ON TABLE "public"."routines" TO "authenticated";
GRANT ALL ON TABLE "public"."routines" TO "service_role";



GRANT ALL ON TABLE "public"."skin_checkins" TO "anon";
GRANT ALL ON TABLE "public"."skin_checkins" TO "authenticated";
GRANT ALL ON TABLE "public"."skin_checkins" TO "service_role";



GRANT ALL ON TABLE "public"."skin_logs" TO "anon";
GRANT ALL ON TABLE "public"."skin_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."skin_logs" TO "service_role";



GRANT ALL ON TABLE "public"."skin_profiles" TO "anon";
GRANT ALL ON TABLE "public"."skin_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."skin_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."spf_reminder_log" TO "anon";
GRANT ALL ON TABLE "public"."spf_reminder_log" TO "authenticated";
GRANT ALL ON TABLE "public"."spf_reminder_log" TO "service_role";



GRANT ALL ON TABLE "public"."storage_cleanup_queue" TO "anon";
GRANT ALL ON TABLE "public"."storage_cleanup_queue" TO "authenticated";
GRANT ALL ON TABLE "public"."storage_cleanup_queue" TO "service_role";



GRANT ALL ON TABLE "public"."user_products" TO "anon";
GRANT ALL ON TABLE "public"."user_products" TO "authenticated";
GRANT ALL ON TABLE "public"."user_products" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";








-- ---------------------------------------------------------------
-- Objects outside the public schema. Only the ones we own: the bucket,
-- its policies, the signup trigger and the cron jobs. Storage's own
-- tables and types are created by the platform, not by us.
-- On a fresh project the Vault secret must be recreated by hand:
--   select vault.create_secret('<service role key>', 'service_role_key');
-- ---------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('progress-photos', 'progress-photos', false)
on conflict (id) do nothing;

drop policy if exists "Users read their own progress photo files"   on storage.objects;
drop policy if exists "Users upload their own progress photo files" on storage.objects;
drop policy if exists "Users update their own progress photo files" on storage.objects;
drop policy if exists "Users delete their own progress photo files" on storage.objects;

create policy "Users read their own progress photo files"
  on storage.objects for select to authenticated
  using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users upload their own progress photo files"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users update their own progress photo files"
  on storage.objects for update to authenticated
  using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users delete their own progress photo files"
  on storage.objects for delete to authenticated
  using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  wanted text := nullif(trim(new.raw_user_meta_data ->> 'username'), '');
begin
  if wanted is not null and (
       char_length(wanted) not between 2 and 30
       or exists (select 1 from public.profiles p
                  where lower(p.username) = lower(wanted))
     ) then
    wanted := null;
  end if;

  insert into public.profiles (id, username, onboarding_completed)
  values (new.id, wanted, false)
  on conflict (id) do nothing;

  return new;

exception when others then
  insert into public.profiles (id, username, onboarding_completed)
  values (new.id, null, false)
  on conflict (id) do nothing;
  return new;
end;
$function$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Cron: production-only. Wrapped so a local stack without pg_cron still
-- rebuilds cleanly — the schedule is documentation here, not behaviour.
do $cron$
begin
  create extension if not exists pg_cron;
  create extension if not exists pg_net;

  perform cron.schedule(
    'send-routine-reminders',
    '*/5 * * * *',
    $job$
    select net.http_post(
      url := 'https://qztxxldcbthivonokqij.supabase.co/functions/v1/send-reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret from vault.decrypted_secrets
          where name = 'service_role_key'
        )
      )
    );
    $job$
  );

  perform cron.schedule(
    'storage-cleanup-daily',
    '17 3 * * *',
    $job$
    select net.http_post(
      url := 'https://qztxxldcbthivonokqij.supabase.co/functions/v1/storage-cleanup',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret from vault.decrypted_secrets
          where name = 'service_role_key'
        )
      ),
      body := '{}'::jsonb
    );
    $job$
  );
exception when others then
  raise notice 'Skipping cron setup: %', sqlerrm;
end
$cron$;
