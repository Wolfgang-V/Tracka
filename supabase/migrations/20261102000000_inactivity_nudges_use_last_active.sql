-- "You've been gone for 2 days" fired for people who'd ticked their routine
-- that morning. due_login_nudges counted from auth.users.last_sign_in_at,
-- which only moves on a fresh password login — the installed PWA keeps
-- people signed in for weeks, so daily users looked gone.
--
-- Now counts from last activity, the same definition as admin "Last
-- active" (20261013000000): the latest of password sign-in, session
-- refresh (any app open) and routine tick. Thresholds change from
-- 24h / 48h to 2 days / 7 days of no activity.
--
-- login_at keeps its name (it's the log's key) but now holds the
-- last-activity time, so each fresh lapse gets its own pair of nudges.
--
-- Deploy order: the send-reminders edge function FIRST (it knows the 168h
-- copy), then this migration. The other way round, a 7-day row would go
-- out with the 2-day wording.

alter table login_nudge_log drop constraint login_nudge_log_hours_since_login_check;
alter table login_nudge_log add constraint login_nudge_log_hours_since_login_check
  check (hours_since_login in (24, 48, 168));

create or replace function due_login_nudges(window_minutes integer default 6)
returns table (
  user_id uuid,
  username text,
  hours_since_login integer,
  login_at timestamptz,
  subscription jsonb
)
language sql
security definer
set search_path = public
as $$
  with candidates as (
    select
      au.id as user_id,
      p.username,
      ps.subscription,
      -- greatest() skips nulls in Postgres; created_at is the floor for
      -- someone who signed up and never came back.
      greatest(
        au.created_at,
        au.last_sign_in_at,
        (select max(s.updated_at) from auth.sessions s where s.user_id = au.id),
        (select max(c.completed_at) from routine_step_completions c where c.user_id = au.id)
      ) as login_at,
      now() as checked_at
    from auth.users au
    join profiles p on p.id = au.id
    join push_subscriptions ps on ps.user_id = au.id
  ),
  thresholds as (
    select c.*, t.hours_since_login,
           c.login_at + make_interval(hours => t.hours_since_login) as due_at
    from candidates c
    cross join (values (48), (168)) as t(hours_since_login)
  )
  select t.user_id, t.username, t.hours_since_login, t.login_at, t.subscription
  from thresholds t
  where t.checked_at >= t.due_at
    and t.checked_at < t.due_at + (window_minutes || ' minutes')::interval
    and not exists (
      select 1 from login_nudge_log l
      where l.user_id = t.user_id
        and l.hours_since_login = t.hours_since_login
        and l.login_at = t.login_at
    );
$$;

revoke all on function due_login_nudges(integer) from public, anon, authenticated;
grant execute on function due_login_nudges(integer) to service_role;
