create table if not exists reminder_followup_log (
  user_id    uuid not null references auth.users(id) on delete cascade,
  slot       text not null check (slot in ('morning', 'night')),
  local_date date not null,
  sent_at    timestamptz not null default now(),
  primary key (user_id, slot, local_date)
);

alter table reminder_followup_log enable row level security;

create table if not exists inactivity_nudge_log (
  user_id                 uuid not null references auth.users(id) on delete cascade,
  days_inactive           int not null check (days_inactive in (3, 7)),
  last_completed_snapshot date not null,
  sent_at                 timestamptz not null default now(),
  primary key (user_id, days_inactive, last_completed_snapshot)
);

alter table inactivity_nudge_log enable row level security;

create or replace function due_followups(window_minutes int default 6)
returns table (
  user_id uuid,
  username text,
  slot text,
  local_date date,
  subscription jsonb
)
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
        and comp.local_date = c.local_date
        and r.time_of_day = (case when c.slot = 'morning' then 'AM' else 'PM' end)
    );
$$;

-- Changes from the draft, all in this function:
--  * joins reminder_settings and requires at least one reminder enabled,
--    so people who switched reminders off don't get nudged anyway
--  * "today" comes from the user's own timezone, not the server's UTC date
--  * every column aliased: unqualified names collide with the RETURNS TABLE
--    output names in a SQL-language function and raise "ambiguous"
create or replace function due_inactivity_nudges()
returns table (
  user_id uuid,
  username text,
  days_inactive int,
  last_completed date,
  subscription jsonb
)
language sql
security definer
set search_path = public
as $$
  with last_active as (
    select
      ps.user_id      as uid,
      p.username      as uname,
      ps.subscription as sub,
      (now() at time zone coalesce(rs.timezone, 'UTC'))::date as today_local,
      (select max(rc.completed_date)
         from routine_completions rc
        where rc.user_id = ps.user_id) as last_done
    from push_subscriptions ps
    join profiles p           on p.id = ps.user_id
    join reminder_settings rs on rs.user_id = ps.user_id
    where rs.morning_enabled or rs.night_enabled
  ),
  spans as (
    select la.*, d.n
    from last_active la
    cross join (values (3), (7)) as d(n)
  )
  select s.uid, s.uname, s.n, s.last_done, s.sub
  from spans s
  where s.last_done is not null
    and s.last_done = s.today_local - s.n
    and not exists (
      select 1 from inactivity_nudge_log l
      where l.user_id = s.uid
        and l.days_inactive = s.n
        and l.last_completed_snapshot = s.last_done
    );
$$;

revoke execute on function due_followups(int)        from anon, authenticated;
revoke execute on function due_inactivity_nudges()   from anon, authenticated;;
