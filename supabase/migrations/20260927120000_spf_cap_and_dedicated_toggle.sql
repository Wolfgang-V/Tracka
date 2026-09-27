-- Two changes, both from the same review: nine notifications a day
-- (morning + its follow-up, night + its follow-up, five SPF pings) is
-- more than a bank or messaging app sends, and the realistic outcome is
-- people disable notifications for the app entirely — losing the
-- reminder feature altogether, not just the SPF pings.
--
-- 1. Cap reapplications at 2 instead of 6 — a midday and a mid-afternoon
--    nudge, covering the commute/lunch window most people actually get
--    sun in, rather than assuming someone's outdoors all day.
--
-- 2. A dedicated, default-off toggle instead of piggybacking on
--    morning_enabled. Bundling it under "remind me to start my routine"
--    meant anyone with morning reminders on got sunscreen pings they
--    never separately asked for. This makes it opt-in.
alter table reminder_settings
  add column if not exists spf_reapply_enabled boolean not null default false;

create or replace function due_spf_reminders(window_minutes int default 6)
returns table (
  user_id uuid,
  username text,
  subscription jsonb,
  reapply_number int,
  local_date date
)
language sql
security definer
set search_path = public
as $$
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
    -- Explicit opt-in only, unlike morning/night reminders — no settings
    -- row, or the box left unchecked, both mean no.
    where rs.spf_reapply_enabled
  ),
  applied as (
    select
      s.user_id, s.username, s.subscription, s.local_now,
      min(comp.completed_at at time zone s.tz) as applied_at
    from settings s
    join routines r  on r.user_id = s.user_id and r.is_active and r.time_of_day = 'AM'
    join routine_steps rst on rst.routine_id = r.id and rst.is_active
    join user_products up  on up.id = rst.user_product_id
    join products pr       on pr.id = up.product_id and lower(pr.category) = 'sunscreen'
    join routine_step_completions comp
      on comp.routine_step_id = rst.id
     and comp.user_id = s.user_id
     and comp.local_date = (s.local_now)::date
    group by s.user_id, s.username, s.subscription, s.local_now
  ),
  candidates as (
    select
      a.user_id, a.username, a.subscription, a.local_now,
      (a.local_now)::date as local_date,
      n as reapply_number,
      a.applied_at + (n * interval '2 hours') as target_at
    from applied a
    cross join generate_series(1, 2) as n
  )
  select c.user_id, c.username, c.subscription, c.reapply_number, c.local_date
  from candidates c
  where c.target_at::time <= time '17:00'
    and c.local_now between c.target_at and c.target_at + (window_minutes || ' minutes')::interval
    and not exists (
      select 1 from spf_reminder_log l
      where l.user_id = c.user_id
        and l.local_date = c.local_date
        and l.reapply_number = c.reapply_number
    );
$$;

revoke all on function due_spf_reminders(int) from public, anon, authenticated;
