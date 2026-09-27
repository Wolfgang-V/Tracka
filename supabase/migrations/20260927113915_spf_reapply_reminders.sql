create table if not exists spf_reminder_log (
  user_id        uuid not null references auth.users(id) on delete cascade,
  local_date     date not null,
  reapply_number int not null,
  sent_at        timestamptz not null default now(),
  primary key (user_id, local_date, reapply_number)
);

alter table spf_reminder_log enable row level security;

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
    left join reminder_settings rs on rs.user_id = ps.user_id
    -- Someone who switched their morning reminder off hasn't asked for this
    -- either. No settings row at all means they never chose, so allow it.
    where coalesce(rs.morning_enabled, true)
  ),
  applied as (
    -- min(), and grouped: two sunscreens in one AM routine would otherwise
    -- produce two identical rows per slot and send the push twice before
    -- the log's primary key could stop it.
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
    cross join generate_series(1, 6) as n
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

revoke all on function due_spf_reminders(int) from public, anon, authenticated;;
