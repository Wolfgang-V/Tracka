-- Every other reminder type is either toggleable, capped, or both. This
-- one had neither: with zero existing skin_logs.note rows (the column is
-- ninety seconds old), it would have fired unconditionally, once a day,
-- forever, to every push-enabled user. Same fix as the SPF cap/toggle
-- pass — a dedicated, default-off switch, so the people who want a diary
-- habit get it and nobody else gets a daily nag they never asked for.
alter table reminder_settings
  add column if not exists diary_nudge_enabled boolean not null default false;

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
    join reminder_settings rs on rs.user_id = ps.user_id
    where rs.diary_nudge_enabled
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
