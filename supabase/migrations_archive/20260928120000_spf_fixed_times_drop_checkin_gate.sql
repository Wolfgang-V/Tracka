-- Two changes from user feedback after seeing the feature live:
--
-- 1. Fixed local times (12:00 and 15:00) instead of "2h/4h after the AM
--    sunscreen step was ticked". Simpler to reason about, and doesn't
--    quietly skip someone who does their routine unusually early or late.
--
-- 2. Drop the "Heading out today?" check-in gate. Opting into the toggle
--    in Settings is now the only decision needed — the daily in-app
--    prompt this depended on has been removed from the client, so a
--    function that still required it would silently stop sending to
--    everyone. spf_daily_checkin itself is left in place (unused, not
--    dropped) rather than deleting real user answer data.
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
    where rs.spf_reapply_enabled
  ),
  applied as (
    -- Anyone with an active AM sunscreen step they've ticked today —
    -- existence check rather than a join, so a routine with more than
    -- one sunscreen product doesn't produce duplicate candidate rows.
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

revoke all on function due_spf_reminders(int) from public, anon, authenticated;
