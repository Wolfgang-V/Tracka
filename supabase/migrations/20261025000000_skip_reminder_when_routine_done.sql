-- User feedback: "whenever I do my routine before the preset time, it still
-- sends the reminder when it's time." due_reminders only checked the time
-- and whether today's reminder had already gone out — never whether the
-- routine was already done.
--
-- Now a slot's reminder is skipped if, for that slot today, the person has
-- either ticked any of its steps or tapped "Complete … routine". Same
-- "already engaged" rule the 30-minute follow-up (due_followups) has always
-- used, plus the explicit completion.
--
-- Signature and return type unchanged, so this is a straight replacement;
-- grants repeated per migrations/README.md.

create or replace function due_reminders(window_minutes integer default 6)
returns table (user_id uuid, username text, slot text, local_date date, subscription jsonb)
language sql
security definer
set search_path = public
as $$
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
    ('morning', rs.morning_enabled, rs.morning_time, 'AM'),
    ('night',   rs.night_enabled,   rs.night_time,   'PM')
  ) as s(kind, enabled, at_time, time_of_day)
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
    )
    -- Already ticked a step from this routine today.
    and not exists (
      select 1
      from routine_step_completions comp
      join routine_steps rst on rst.id = comp.routine_step_id
      join routines r on r.id = rst.routine_id
      where comp.user_id = rs.user_id
        and r.user_id = rs.user_id -- added by reviewer on apply: tie the routine to the same person
        and comp.local_date = (now() at time zone rs.timezone)::date
        and r.time_of_day = s.time_of_day
    )
    -- Already tapped "Complete morning/night routine" today.
    and not exists (
      select 1 from routine_completions rc
      where rc.user_id = rs.user_id
        and rc.completed_date = (now() at time zone rs.timezone)::date
        and rc.time_of_day = s.time_of_day
    );
$$;

revoke all on function due_reminders(integer) from public, anon, authenticated;
grant execute on function due_reminders(integer) to service_role;
