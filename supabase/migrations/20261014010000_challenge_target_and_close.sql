-- Two consequences of the shared window (20261014000000), both decided:
--
-- 1. Finish line below the window. With a 30-day window AND a 30-day target
--    only day-one joiners who never missed could ever complete. New
--    target_days (null = duration_days): 30 Days of SPF completes at 25 of
--    30, so late joiners can still finish and one missed morning isn't fatal.
--    Completing no longer stops the count inside a window — the leaderboard
--    ranks by total days, so someone who completes on day 25 must keep
--    accumulating or they'd be overtaken by people still ticking.
--
-- 2. Closing. After ends_on nothing counts, but un-completed participants
--    stayed 'active' forever. New status 'ended' (not 'left' — they didn't
--    quit, so "left halfway" keeps its meaning). close_ended_challenges()
--    does it; admin_challenge_stats runs it first, so the admin dashboard
--    is always correct without a cron job. It can also be run by hand.

alter table challenge_participants
  drop constraint if exists challenge_participants_status_check;
alter table challenge_participants
  add constraint challenge_participants_status_check
    check (status in ('active', 'completed', 'left', 'ended'));

alter table challenges
  add column if not exists target_days integer;
alter table challenges
  drop constraint if exists challenges_target_days_check;
alter table challenges
  add constraint challenges_target_days_check
    check (target_days is null or (target_days >= 1 and target_days <= duration_days));

update challenges set target_days = 25 where slug = 'spf-30';


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
    select cp.id, c.rule, coalesce(c.target_days, c.duration_days) as target
    from challenge_participants cp
    join challenges c on c.id = cp.challenge_id
    where cp.user_id = p_user
      -- Inside a shared window, completed people keep counting for the
      -- leaderboard; a per-person challenge stops at completion as before.
      and (cp.status = 'active' or (cp.status = 'completed' and c.ends_on is not null))
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

    -- Completion is one-way and keeps its original timestamp, even though
    -- the count keeps moving afterwards.
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
$$;

revoke all on function refresh_challenge_progress(uuid, date) from public, anon, authenticated;


-- The tick trigger's early-out only let 'active' people through, so a
-- completed person in a still-running window never reached the refresh
-- above. Same cheap indexed check, widened to match.
create or replace function challenge_progress_from_completion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := coalesce(new.user_id, old.user_id);
  v_date date := coalesce(new.local_date, old.local_date);
begin
  -- Cheap early-out: almost nobody ticking a step is in a challenge.
  if exists (
    select 1 from challenge_participants
    where user_id = v_user and status in ('active', 'completed')
  ) then
    perform refresh_challenge_progress(v_user, v_date);
    if tg_op = 'UPDATE' and old.local_date is distinct from new.local_date then
      perform refresh_challenge_progress(v_user, old.local_date);
    end if;
  end if;

  return null;
end;
$$;

revoke all on function challenge_progress_from_completion() from public, anon, authenticated;


create or replace function close_ended_challenges()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_closed integer;
begin
  update challenge_participants cp
  set status = 'ended'
  from challenges c
  where c.id = cp.challenge_id
    and cp.status = 'active'
    and c.ends_on is not null
    and c.ends_on < (now() at time zone 'Africa/Lagos')::date;

  get diagnostics v_closed = row_count;
  return v_closed;
end;
$$;

revoke all on function close_ended_challenges() from public, anon, authenticated;
grant execute on function close_ended_challenges() to service_role;


-- Ended participants are still ranked — the final leaderboard is made of
-- exactly these people.
create or replace function challenge_ranking(p_challenge_id uuid)
returns table (
  rank bigint,
  participant_id uuid,
  user_id uuid,
  username text,
  status text,
  days_completed integer,
  reached_at timestamptz,
  hidden boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with best as (
    select distinct on (cp.user_id) cp.*
    from challenge_participants cp
    where cp.challenge_id = p_challenge_id
      and cp.status in ('active', 'completed', 'ended')
    order by cp.user_id, cp.days_completed desc, cp.joined_at desc
  ),
  scored as (
    select
      b.id, b.user_id, b.status, b.days_completed, b.hide_from_leaderboard,
      (select max(cd.created_at) from challenge_days cd where cd.participant_id = b.id) as reached_at
    from best b
  )
  select
    row_number() over (order by s.days_completed desc, s.reached_at asc nulls last, s.id),
    s.id,
    s.user_id,
    pr.username,
    s.status,
    s.days_completed,
    s.reached_at,
    s.hide_from_leaderboard
  from scored s
  left join profiles pr on pr.id = s.user_id
  order by 1;
$$;

revoke all on function challenge_ranking(uuid) from public, anon, authenticated;


-- Gains ended_count + target_days, and closes finished windows first.
-- RETURNS TABLE change → drop + create, grants repeated.
drop function if exists admin_challenge_stats();

create function admin_challenge_stats()
returns table (
  challenge_id uuid,
  title text,
  duration_days integer,
  target_days integer,
  is_published boolean,
  participants bigint,
  active_count bigint,
  completed_count bigint,
  ended_count bigint,
  left_count bigint,
  left_before_half bigint,
  avg_days_when_left numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from auth.users u
    where u.id = auth.uid() and u.email = 'trackaplusapp@gmail.com'
  ) then
    raise exception 'Not authorized';
  end if;

  perform close_ended_challenges();

  return query
  select
    c.id,
    c.title,
    c.duration_days,
    coalesce(c.target_days, c.duration_days),
    c.is_published,
    count(distinct cp.user_id),
    count(cp.id) filter (where cp.status = 'active'),
    count(cp.id) filter (where cp.status = 'completed'),
    count(cp.id) filter (where cp.status = 'ended'),
    count(cp.id) filter (where cp.status = 'left'),
    count(cp.id) filter (where cp.status = 'left' and cp.days_completed * 2 < coalesce(c.target_days, c.duration_days)),
    round(avg(cp.days_completed) filter (where cp.status = 'left'), 1)
  from challenges c
  left join challenge_participants cp on cp.challenge_id = c.id
  group by c.id
  order by c.created_at;
end;
$$;

revoke all on function admin_challenge_stats() from public, anon;
grant execute on function admin_challenge_stats() to authenticated;


-- Added by the reviewer when applying (pulled back from live so the repo
-- matches): completing at 25 inside a running window leaves days to go, and
-- ALREADY_JOINED only looked for 'active' — a completed person could join
-- again, get a second participation, and see their own screen reset to zero.
-- Inside a running window, completed now counts as joined.
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
    where challenge_id = p_challenge_id
      and user_id = v_user
      and (
        status = 'active'
        or (status = 'completed' and v_challenge.ends_on is not null)
      )
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

  perform refresh_challenge_progress(v_user, p_local_date);

  return v_id;
end;
$$;

revoke all on function join_challenge(uuid, date) from public, anon;
grant execute on function join_challenge(uuid, date) to authenticated;
