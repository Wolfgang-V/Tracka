-- Nudges anyone who hasn't saved a diary note yet today, once, around
-- mid-afternoon. Doesn't depend on morning/night reminder toggles or on
-- having completed a routine — it's just "have you written anything
-- today", checked once per user per day.
create table if not exists diary_nudge_log (
  user_id    uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  sent_at    timestamptz not null default now(),
  primary key (user_id, local_date)
);

alter table diary_nudge_log enable row level security;

create or replace function due_diary_nudges(window_minutes int default 6)
returns table (
  user_id uuid,
  username text,
  subscription jsonb,
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
      coalesce(rs.timezone, 'Africa/Lagos') as tz,
      (now() at time zone coalesce(rs.timezone, 'Africa/Lagos')) as local_now
    from push_subscriptions ps
    join profiles p on p.id = ps.user_id
    left join reminder_settings rs on rs.user_id = ps.user_id
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

revoke all on function due_diary_nudges(int) from public, anon, authenticated;
