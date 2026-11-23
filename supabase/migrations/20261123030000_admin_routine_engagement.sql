-- Admin → Routines: who is completing their AM / PM routines, for
-- personalised emails (exported as CSV for Zoho Campaigns; direct sync later).
--
-- One row per confirmed account: names, email permissions, which routines
-- they have, and how many days they completed AM / PM in the last 7 and 30
-- days (routine_completions: one row per person, local date and AM/PM, written
-- when the whole routine is ticked off).
--
-- Email permissions travel with every row so the export can't be used
-- carelessly: marketing_opt_in (ticked at sign-up / in Settings) and
-- email_suppressed (clicked "Don't email me again"). Promotional sends must
-- use opted-in, non-suppressed people only; the UI defaults to that.
--
-- Read-only. Same admin check as the referral console (can_manage_referrals).
--
-- Ship order: this migration FIRST, then the app (Admin → Routines calls it).

create or replace function admin_routine_engagement()
returns table (
  user_id uuid,
  email text,
  first_name text,
  last_name text,
  username text,
  created_at timestamptz,
  onboarding_completed boolean,
  marketing_opt_in boolean,
  email_suppressed boolean,
  has_am_routine boolean,
  has_pm_routine boolean,
  am_7d int,
  pm_7d int,
  am_30d int,
  pm_30d int,
  last_am date,
  last_pm date
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not can_manage_referrals() then
    raise exception 'Not authorized';
  end if;

  return query
  with done as (
    select rc.user_id,
           count(*) filter (where rc.time_of_day = 'AM' and rc.completed_date > current_date - 7)  as am_7d,
           count(*) filter (where rc.time_of_day = 'PM' and rc.completed_date > current_date - 7)  as pm_7d,
           count(*) filter (where rc.time_of_day = 'AM' and rc.completed_date > current_date - 30) as am_30d,
           count(*) filter (where rc.time_of_day = 'PM' and rc.completed_date > current_date - 30) as pm_30d,
           max(rc.completed_date) filter (where rc.time_of_day = 'AM') as last_am,
           max(rc.completed_date) filter (where rc.time_of_day = 'PM') as last_pm
    from routine_completions rc
    group by rc.user_id
  ),
  slots as (
    select r.user_id,
           bool_or(r.time_of_day = 'AM') as has_am,
           bool_or(r.time_of_day = 'PM') as has_pm
    from routines r
    where r.is_active
    group by r.user_id
  )
  select u.id,
         u.email::text,
         p.first_name,
         p.last_name,
         p.username,
         u.created_at,
         coalesce(p.onboarding_completed, false),
         coalesce(p.marketing_opt_in, false),
         coalesce(p.email_suppressed, false),
         coalesce(s.has_am, false),
         coalesce(s.has_pm, false),
         coalesce(d.am_7d, 0)::int,
         coalesce(d.pm_7d, 0)::int,
         coalesce(d.am_30d, 0)::int,
         coalesce(d.pm_30d, 0)::int,
         d.last_am,
         d.last_pm
  from auth.users u
  left join profiles p on p.id = u.id
  left join done d on d.user_id = u.id
  left join slots s on s.user_id = u.id
  where u.email_confirmed_at is not null
    and u.deleted_at is null
    and u.email is not null
  order by coalesce(d.am_7d, 0) + coalesce(d.pm_7d, 0) desc, u.created_at desc;
end;
$$;

revoke all on function admin_routine_engagement() from public, anon;
grant execute on function admin_routine_engagement() to authenticated;
