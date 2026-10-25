-- Same complaint as 20261025000000, one step later: the 30-minute follow-up
-- only checked for ticked steps, not a tapped "Complete … routine", so it
-- could still nudge someone who'd finished. Adds that check (reviewer's
-- clause), and ties the step-completion check's routine back to the same
-- person, matching the fix made to due_reminders on apply.
--
-- Signature and return type unchanged; grants repeated per
-- migrations/README.md.

create or replace function due_followups(window_minutes integer default 6)
returns table (user_id uuid, username text, slot text, local_date date, subscription jsonb)
language sql
security definer
set search_path = public
as $$
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
        and r.user_id = c.user_id
        and comp.local_date = c.local_date
        and r.time_of_day = (case when c.slot = 'morning' then 'AM' else 'PM' end)
    )
    and not exists (
      select 1 from routine_completions rc
      where rc.user_id = c.user_id
        and rc.completed_date = c.local_date
        and rc.time_of_day = (case when c.slot = 'morning' then 'AM' else 'PM' end)
    );
$$;

revoke all on function due_followups(integer) from public, anon, authenticated;
grant execute on function due_followups(integer) to service_role;
