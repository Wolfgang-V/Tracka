-- Referral console (admin screen) — the bits the existing referral
-- functions don't cover: daily activity for the chart, and retiring /
-- reactivating a code.
--
-- Access is decided in ONE place, can_manage_referrals(). Today it's the
-- admin account only. When team members (a "referral manager" role) or
-- partners get access later, change this function — every console RPC
-- below follows it automatically. (The reviewer's original four referral
-- functions still check the admin email directly; switch them to this
-- helper next time they're touched.)

create or replace function can_manage_referrals()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from auth.users u
    where u.id = auth.uid() and u.email = 'trackaplusapp@gmail.com'
  );
$$;

revoke all on function can_manage_referrals() from public, anon;
grant execute on function can_manage_referrals() to authenticated;


-- Scans and new sign-ups per day for the last p_days days (Lagos dates),
-- optionally for one partner. Every day is present, zero-filled, so the
-- chart has no gaps.
create or replace function admin_referral_activity(p_days integer default 30, p_partner_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 7), 180);
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_result jsonb;
begin
  if not can_manage_referrals() then
    raise exception 'Not authorized';
  end if;

  with days as (
    select generate_series(v_today - (v_days - 1), v_today, interval '1 day')::date as d
  ),
  codes as (
    select id from referral_codes
    where p_partner_id is null or partner_id = p_partner_id
  ),
  scans as (
    select s.scan_date as d, count(*) as n
    from referral_scans s
    where s.code_id in (select id from codes)
      and s.scan_date >= v_today - (v_days - 1)
    group by 1
  ),
  signups as (
    select (a.attributed_at at time zone 'Africa/Lagos')::date as d, count(*) as n
    from referral_attributions a
    where a.code_id in (select id from codes)
      and a.new_signup
      and a.attributed_at >= (v_today - (v_days - 1))::timestamp at time zone 'Africa/Lagos'
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'date', days.d,
           'scans', coalesce(scans.n, 0),
           'signups', coalesce(signups.n, 0)
         ) order by days.d), '[]'::jsonb)
  into v_result
  from days
  left join scans on scans.d = days.d
  left join signups on signups.d = days.d;

  return v_result;
end;
$$;

revoke all on function admin_referral_activity(integer, uuid) from public, anon;
grant execute on function admin_referral_activity(integer, uuid) to authenticated;


-- Retire a code (flyer withdrawn, partnership ended) or bring it back.
-- A retired code's scans are ignored by record_referral_scan; existing
-- attributions and history are kept.
create or replace function admin_set_referral_code_active(p_code text, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not can_manage_referrals() then
    raise exception 'Not authorized';
  end if;

  update referral_codes
  set is_active = coalesce(p_active, false)
  where code = upper(trim(p_code));

  if not found then
    raise exception 'No such code';
  end if;

  insert into admin_audit_log (actor_id, action, target_id, details)
  values (auth.uid(),
          case when p_active then 'activate_referral_code' else 'retire_referral_code' end,
          null,
          jsonb_build_object('code', upper(trim(p_code))));
end;
$$;

revoke all on function admin_set_referral_code_active(text, boolean) from public, anon;
grant execute on function admin_set_referral_code_active(text, boolean) to authenticated;
