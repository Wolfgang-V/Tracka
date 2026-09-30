-- One row per reminder actually sent. The unique key is what stops
-- a retried or overlapping cron run from notifying someone twice.
create table if not exists reminder_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  slot       text not null check (slot in ('morning','night')),
  local_date date not null,
  sent_at    timestamptz not null default now(),
  unique (user_id, slot, local_date)
);

alter table reminder_log enable row level security;

create policy "Users can see their own reminder history"
  on reminder_log for select
  using (auth.uid() = user_id);

-- Who is due right now. Time maths stays in SQL, where timezones are solid.
create or replace function public.due_reminders(window_minutes int default 6)
returns table (
  user_id      uuid,
  username     text,
  slot         text,
  local_date   date,
  subscription jsonb
)
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

revoke execute on function public.due_reminders(int) from anon, authenticated;;
