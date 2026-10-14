-- Challenges run in one shared window instead of 30 days per person.
--
-- 30 Days of SPF started the day the first person joined (10 Oct 2026) and
-- ends 30 days later (8 Nov, inclusive). Anyone can join while it's running
-- and counts the days that are left; once it ends nothing more counts, no
-- one new can join, and the final leaderboard picks the winners.
--
-- starts_on/ends_on are nullable so a future always-open challenge can
-- still run per-person as before.

alter table challenges
  add column if not exists starts_on date,
  add column if not exists ends_on date;

alter table challenges

  drop constraint if exists challenges_window_check;
alter table challenges
  add constraint challenges_window_check
    check (starts_on is null or ends_on is null or ends_on >= starts_on);

update challenges
set starts_on = date '2026-10-10',
    ends_on = date '2026-11-08'
where slug = 'spf-30';


-- Same as before, plus: days outside the challenge window never count.
create or replace function refresh_challenge_progress(p_user uuid, p_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
  v_done boolean;
  v_count integer;
begin
  for v in
    select cp.id, c.rule, c.duration_days
    from challenge_participants cp
    join challenges c on c.id = cp.challenge_id
    where cp.user_id = p_user
      and cp.status = 'active'
      and cp.start_date <= p_date
      and (c.starts_on is null or p_date >= c.starts_on)
      and (c.ends_on is null or p_date <= c.ends_on)
  loop
    v_done := false;

    if v.rule = 'am_sunscreen' then
      -- Deliberately doesn't require the step/routine to still be active:
      -- a routine rebuild later in the day deactivates the old steps, but
      -- the tick still happened.
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
        status = case when v_count >= v.duration_days then 'completed' else status end,
        completed_at = case when v_count >= v.duration_days then now() else completed_at end
    where id = v.id;
  end loop;
end;
$$;

revoke all on function refresh_challenge_progress(uuid, date) from public, anon, authenticated;


-- Same as before, plus: can't join once the window has closed
-- (CHALLENGE_ENDED) or before it opens (CHALLENGE_NOT_STARTED).
create or replace function join_challenge(p_challenge_id uuid, p_local_date date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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

  -- Same ±1 day timezone grace used elsewhere for client-sent local dates.
  if p_local_date is null or p_local_date < v_today - 1 or p_local_date > v_today + 1 then
    raise exception 'Invalid date';
  end if;

  if v_challenge.ends_on is not null and p_local_date > v_challenge.ends_on then
    raise exception 'CHALLENGE_ENDED';
  end if;

  if v_challenge.starts_on is not null and p_local_date < v_challenge.starts_on then
    raise exception 'CHALLENGE_NOT_STARTED';
  end if;

  if exists (
    select 1 from challenge_participants
    where challenge_id = p_challenge_id and user_id = v_user and status = 'active'
  ) then
    raise exception 'ALREADY_JOINED';
  end if;

  if v_challenge.rule = 'am_sunscreen' and not exists (
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
  values (p_challenge_id, v_user, p_local_date)
  returning id into v_id;

  -- Already ticked sunscreen this morning before joining? Count it.
  perform refresh_challenge_progress(v_user, p_local_date);

  return v_id;
end;
$$;

revoke all on function join_challenge(uuid, date) from public, anon;
grant execute on function join_challenge(uuid, date) to authenticated;
