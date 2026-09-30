create table if not exists onboarding_nudge_log (
  user_id uuid primary key references auth.users(id) on delete cascade,
  sent_at timestamptz not null default now()
);

alter table onboarding_nudge_log enable row level security;

create or replace function due_onboarding_nudges()
returns table (
  user_id uuid,
  username text,
  subscription jsonb
)
language sql
security definer
set search_path = public
as $$
  select ps.user_id, p.username, ps.subscription
  from push_subscriptions ps
  join profiles p    on p.id = ps.user_id
  join auth.users u  on u.id = ps.user_id
  -- Left join on purpose: someone who never reached the reminders screen has
  -- no settings row at all, and that's most of the people this targets.
  -- Only exclude those who explicitly switched everything off.
  left join reminder_settings rs on rs.user_id = ps.user_id
  where coalesce(p.onboarding_completed, false) = false
    and u.created_at between now() - interval '48 hours' and now() - interval '24 hours'
    and coalesce(rs.morning_enabled or rs.night_enabled, true)
    and not exists (
      select 1 from onboarding_nudge_log l where l.user_id = ps.user_id
    );
$$;

-- This returns other users' push credentials. It must never be callable by
-- a logged-in user — service role only, same as the other due_* functions.
revoke all on function due_onboarding_nudges() from public, anon, authenticated;;
