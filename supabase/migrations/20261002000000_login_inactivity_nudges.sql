create table if not exists login_nudge_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  hours_since_login integer not null check (hours_since_login in (24, 48)),
  login_at timestamptz not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, hours_since_login, login_at)
);

alter table login_nudge_log enable row level security;

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
      coalesce(au.last_sign_in_at, au.created_at) as login_at,
      now() as checked_at
    from auth.users au
    join profiles p on p.id = au.id
    join push_subscriptions ps on ps.user_id = au.id
  ),
  thresholds as (
    select c.*, t.hours_since_login,
           c.login_at + make_interval(hours => t.hours_since_login) as due_at
    from candidates c
    cross join (values (24), (48)) as t(hours_since_login)
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