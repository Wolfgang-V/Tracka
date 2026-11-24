-- 30 Days of SPF with Ebun Derma: new rules and copy (final brief, 24 Nov).
--
-- Rule change. The challenge no longer counts a day for ticking sunscreen:
-- a day counts when BOTH the morning and the night routine are marked
-- complete (routine_completions, written by the "complete routine" button
-- on Today). Sunscreen stays a requirement to join (it's a sunscreen
-- sponsor, and the brief says "sunscreen is an essential part of your
-- morning routine"), so the "One step before you join" flow still applies.
-- Target unchanged: 25 of 30 days.
--
--   1. New rule 'am_pm_routines' (rule check widened).
--   2. refresh_challenge_progress counts it: both AM and PM rows in
--      routine_completions for that date. ONLY change: the new branch.
--   3. New trigger on routine_completions. Until now progress only
--      refreshed on step ticks (routine_step_completions), which happen
--      BEFORE the routine is marked complete, so this rule would never have
--      counted without it.
--   4. join_challenge: the sunscreen requirement covers the new rule too.
--      ONLY change from 20261123060000's version: the rule test.
--   5. challenges gains how_it_works (jsonb [{title, body}]) and rewards
--      (text), so each challenge can carry its own "How it works" and prize;
--      the app falls back to its built-in sunscreen steps when they're null.
--   6. The Ebun Derma challenge gets the new rule and the brief's copy, and
--      two pop-ups that described the old rule are reworded.
--
-- Nobody had joined the Ebun Derma challenge when this was written (0
-- participants, it starts 28 Nov), so no progress is recounted.
--
-- Ship order: this migration FIRST, then the app. The current app keeps
-- working with it (it ignores the new columns and shows the built-in steps),
-- but the new copy only shows once the app is deployed.

-- 1. Rule ------------------------------------------------------------------
alter table challenges drop constraint if exists challenges_rule_check;
alter table challenges add constraint challenges_rule_check
  check (rule in ('am_sunscreen', 'am_pm_routines'));

-- 2. Counting --------------------------------------------------------------
create or replace function public.refresh_challenge_progress(p_user uuid, p_date date)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v record;
  v_done boolean;
  v_count integer;
begin
  for v in
    select cp.id, c.rule, coalesce(c.target_days, c.duration_days) as target
    from challenge_participants cp
    join challenges c on c.id = cp.challenge_id
    where cp.user_id = p_user
      and (cp.status = 'active' or (cp.status = 'completed' and c.ends_on is not null))
      and cp.start_date <= p_date
      and (c.starts_on is null or p_date >= c.starts_on)
      and (c.ends_on is null or p_date <= c.ends_on)
  loop
    v_done := false;

    if v.rule = 'am_sunscreen' then
      select exists (
        select 1
        from routine_step_completions comp
        join routine_steps rs on rs.id = comp.routine_step_id
        join routines r on r.id = rs.routine_id
        join user_products up on up.id = rs.user_product_id
        join products p on p.id = up.product_id
        where comp.user_id = p_user
          and comp.local_date = p_date
          and r.user_id = p_user
          and r.time_of_day = 'AM'
          and lower(p.category) = 'sunscreen'
      ) into v_done;
    elsif v.rule = 'am_pm_routines' then
      select count(distinct rc.time_of_day) = 2
      from routine_completions rc
      where rc.user_id = p_user
        and rc.completed_date = p_date
        and rc.time_of_day in ('AM', 'PM')
      into v_done;
    end if;

    if v_done then
      insert into challenge_days (participant_id, local_date)
      values (v.id, p_date)
      on conflict do nothing;
    else
      delete from challenge_days
      where participant_id = v.id and local_date = p_date;
    end if;

    select count(*) into v_count from challenge_days where participant_id = v.id;

    update challenge_participants
    set days_completed = v_count,
        status = case when status = 'active' and v_count >= v.target then 'completed' else status end,
        completed_at = case
          when completed_at is null and v_count >= v.target then now()
          else completed_at
        end
    where id = v.id;
  end loop;
end;
$function$;

-- 3. Refresh when a routine is marked complete ------------------------------
create or replace function public.challenge_progress_from_routine_completion()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid := coalesce(new.user_id, old.user_id);
  v_date date := coalesce(new.completed_date, old.completed_date);
begin
  if exists (
    select 1 from challenge_participants
    where user_id = v_user and status in ('active', 'completed')
  ) then
    perform refresh_challenge_progress(v_user, v_date);
    if tg_op = 'UPDATE' and old.completed_date is distinct from new.completed_date then
      perform refresh_challenge_progress(v_user, old.completed_date);
    end if;
  end if;

  return null;
end;
$function$;

revoke all on function public.challenge_progress_from_routine_completion() from public, anon, authenticated;

drop trigger if exists challenge_progress_on_routine_completion on routine_completions;
create trigger challenge_progress_on_routine_completion
  after insert or delete or update on routine_completions
  for each row execute function challenge_progress_from_routine_completion();

-- 4. Joining: sunscreen required for both rules ------------------------------
create or replace function public.join_challenge(p_challenge_id uuid, p_local_date date)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
  v_challenge challenges%rowtype;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_id uuid;
begin
  if v_user is null then
    raise exception 'Not signed in';
  end if;

  select * into v_challenge from challenges where id = p_challenge_id and is_published;
  if not found then
    raise exception 'Challenge not found';
  end if;

  if p_local_date is null or p_local_date < v_today - 1 or p_local_date > v_today + 1 then
    raise exception 'Invalid date';
  end if;

  if v_challenge.ends_on is not null and p_local_date > v_challenge.ends_on then
    raise exception 'CHALLENGE_ENDED';
  end if;

  if exists (
    select 1 from challenge_participants
    where challenge_id = p_challenge_id
      and user_id = v_user
      and (
        status = 'active'
        or (status = 'completed' and v_challenge.ends_on is not null)
      )
  ) then
    raise exception 'ALREADY_JOINED';
  end if;

  if v_challenge.rule in ('am_sunscreen', 'am_pm_routines') and not exists (
    select 1
    from routines r
    join routine_steps rs on rs.routine_id = r.id
    join user_products up on up.id = rs.user_product_id
    join products p on p.id = up.product_id
    where r.user_id = v_user
      and r.is_active
      and rs.is_active
      and r.time_of_day = 'AM'
      and lower(p.category) = 'sunscreen'
  ) then
    raise exception 'NO_SUNSCREEN_STEP';
  end if;

  insert into challenge_participants (challenge_id, user_id, start_date)
  values (p_challenge_id, v_user, greatest(p_local_date, coalesce(v_challenge.starts_on, p_local_date)))
  returning id into v_id;

  perform refresh_challenge_progress(v_user, p_local_date);

  return v_id;
end;
$function$;

-- 5. Per-challenge "How it works" and rewards --------------------------------
alter table challenges
  add column if not exists how_it_works jsonb,
  add column if not exists rewards text;

-- 6. The Ebun Derma challenge ----------------------------------------------
update challenges set
  rule = 'am_pm_routines',
  tagline = 'Small habits. Consistent routines. Better skin habits.',
  description = 'For the next 30 days, we''re challenging you to stay consistent with your skincare routine and make sunscreen a daily habit.'
    || E'\n\n' || 'Your goal is to complete both your morning and night skincare routines every day and log them on Tracka+.'
    || E'\n\n' || 'Complete at least 25 out of 30 days to qualify for the challenge rewards!'
    || E'\n\n' || 'Missed a day? Don''t give up. Pick up where you left off and keep going.',
  active_subtitle = 'Small habits. Consistent routines. Better skin habits.',
  goal_text = 'Complete both your morning and night routines today.',
  how_it_works = jsonb_build_array(
    jsonb_build_object('title', 'Follow your routines',
      'body', 'Complete your morning and night skincare routines every day. Remember, sunscreen is an essential part of your morning routine.'),
    jsonb_build_object('title', 'Track your progress',
      'body', 'Mark your morning and night routines as complete on Tracka+. Your challenge progress updates automatically.'),
    jsonb_build_object('title', 'Stay consistent',
      'body', 'Complete BOTH your morning and night routines on at least 25 of the 30 challenge days to qualify for the rewards.')
  ),
  rewards = 'A sunscreen from Ebun Derma plus additional goodies for the top 12 participants on the Tracka+ leaderboard.'
where id = 'e8d0a5f1-3c2b-4d7e-9a61-2f5b8c4d0e01';

-- Pop-ups that described the old rule.
update ad_placements set
  body = 'Join 30 Days of SPF with Ebun Derma. Complete your morning and night routines, sunscreen included, and win rewards.'
where id = 'e8d0a5f1-3c2b-4d7e-9a61-2f5b8c4d0e11';

update ad_placements set
  headline = '30 days. Better habits.',
  body = 'Complete both routines on 25 of the 30 days. Top 12 win an Ebun Derma sunscreen plus goodies.'
where id = 'e8d0a5f1-3c2b-4d7e-9a61-2f5b8c4d0e14';
