-- "Heading out today?" — the simple version. Asked once a day, in-app,
-- only to people who already opted into spf_reapply_enabled. The answer
-- gates that day's reminders on top of the existing toggle: opting into
-- the feature means "I want this when relevant," this table is what
-- decides whether today is one of those days.
--
-- Unlike the other _log tables, this one is written directly by the
-- user's own client, not by a security-definer function — it's a normal
-- user action, not an admin operation or a service-role scheduled job —
-- so it needs real RLS policies rather than default-deny.
create table if not exists spf_daily_checkin (
  user_id     uuid not null references auth.users(id) on delete cascade,
  local_date  date not null,
  heading_out boolean not null,
  answered_at timestamptz not null default now(),
  primary key (user_id, local_date)
);

alter table spf_daily_checkin enable row level security;

create policy "Users manage their own SPF check-in"
  on spf_daily_checkin
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

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
    and exists (
      -- today's check-in exists and they said yes; no answer means no reminders
      select 1 from spf_daily_checkin sc
      where sc.user_id = c.user_id
        and sc.local_date = c.local_date
        and sc.heading_out
    )
    and not exists (
      select 1 from spf_reminder_log l
      where l.user_id = c.user_id
        and l.local_date = c.local_date
        and l.reapply_number = c.reapply_number
    );
$$;

revoke all on function due_spf_reminders(int) from public, anon, authenticated;
