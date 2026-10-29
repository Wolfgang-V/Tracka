-- One access check for every referral-admin function (reviewer's point):
-- admin_referral_report and admin_upsert_referral_code still checked the
-- admin email inline, so widening can_manage_referrals() for a future
-- referral-manager role would have let them retire codes but not see the
-- report or create codes. Both now follow the helper. Bodies are otherwise
-- byte-for-byte the live versions (copied from 20261029124042).
--
-- Also: admin_set_referral_code_active's audit row now targets the code's
-- partner instead of null, like every other audit action.
--
-- Not changed: record_referral_scan / claim_referral (not admin-gated) and the
-- app's other admin RPCs (general admin, not referral access).

create or replace function admin_referral_report()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not can_manage_referrals() then
    raise exception 'Not authorized';
  end if;

  with stages as (
    select
      a.code_id,
      a.new_signup,
      coalesce(pr.onboarding_completed, false) as onboarded,
      exists (
        select 1 from routine_step_completions c where c.user_id = a.user_id
      ) or exists (
        select 1 from routine_completions rc where rc.user_id = a.user_id
      ) as logged,
      exists (
        select 1
        from routine_completions rc
        where rc.user_id = a.user_id
        group by rc.completed_date
        having count(distinct rc.time_of_day) >= greatest((
          select count(distinct r.time_of_day)
          from routines r where r.user_id = a.user_id and r.is_active
        ), 1)
      ) as perfect_day
    from referral_attributions a
    left join profiles pr on pr.id = a.user_id
  ),
  scan_rows as (
    select code_id,
           count(*) as scans,
           count(distinct visitor_id) as visitors,
           max(scanned_at) as last_scan_at
    from referral_scans group by code_id
  ),
  code_rows as (
    select
      c.id as code_id,
      c.code,
      c.label,
      c.is_active,
      c.partner_id,
      coalesce(p.name, 'Unassigned') as partner,
      coalesce(p.kind, 'store') as kind,
      p.city,
      coalesce(s.scans, 0) as scans,
      coalesce(s.visitors, 0) as visitors,
      s.last_scan_at,
      coalesce(count(st.code_id) filter (where st.new_signup), 0) as signups,
      coalesce(count(st.code_id) filter (where not st.new_signup), 0) as existing_users,
      coalesce(count(st.code_id) filter (where st.onboarded), 0) as onboarded,
      coalesce(count(st.code_id) filter (where st.logged), 0) as logged_routine,
      coalesce(count(st.code_id) filter (where st.perfect_day), 0) as perfect_day
    from referral_codes c
    left join referral_partners p on p.id = c.partner_id
    left join scan_rows s on s.code_id = c.id
    left join stages st on st.code_id = c.id
    group by c.id, c.code, c.label, c.is_active, c.partner_id, p.name, p.kind, p.city,
             s.scans, s.visitors, s.last_scan_at
  ),
  partner_rows as (
    select
      partner,
      kind,
      city,
      count(*) as codes,
      sum(scans) as scans,
      sum(visitors) as visitors,
      sum(signups) as signups,
      sum(onboarded) as onboarded,
      sum(logged_routine) as logged_routine,
      sum(perfect_day) as perfect_day,
      max(last_scan_at) as last_scan_at
    from code_rows group by partner, kind, city
  )
  select jsonb_build_object(
    'totals', jsonb_build_object(
      'partners',       (select count(*) from referral_partners where is_active),
      'codes',          (select count(*) from referral_codes where is_active),
      'scans',          (select coalesce(sum(scans), 0) from code_rows),
      'visitors',       (select coalesce(sum(visitors), 0) from code_rows),
      'signups',        (select coalesce(sum(signups), 0) from code_rows),
      'onboarded',      (select coalesce(sum(onboarded), 0) from code_rows),
      'logged_routine', (select coalesce(sum(logged_routine), 0) from code_rows),
      'perfect_day',    (select coalesce(sum(perfect_day), 0) from code_rows)
    ),
    'codes', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.scans desc, x.code)
      from code_rows x
    ), '[]'::jsonb),
    'partners', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.signups desc, x.scans desc, x.partner)
      from partner_rows x
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function admin_referral_report() from public, anon;
grant execute on function admin_referral_report() to authenticated;


-- Admin: create a partner and its first code in one call, or add another
-- code to an existing partner.
create or replace function admin_upsert_referral_code(
  p_code text,
  p_partner_name text,
  p_kind text default 'store',
  p_label text default null,
  p_city text default null,
  p_contact_phone text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner uuid;
  v_code_id uuid;
  v_code text := upper(trim(p_code));
begin
  if not can_manage_referrals() then
    raise exception 'Not authorized';
  end if;

  select id into v_partner from referral_partners
  where lower(name) = lower(trim(p_partner_name)) limit 1;

  if v_partner is null then
    insert into referral_partners (name, kind, city, contact_phone, created_by)
    values (trim(p_partner_name), p_kind, p_city, p_contact_phone, auth.uid())
    returning id into v_partner;
  end if;

  insert into referral_codes (code, partner_id, label, created_by)
  values (v_code, v_partner, p_label, auth.uid())
  on conflict (code) do update
    set partner_id = excluded.partner_id,
        label      = coalesce(excluded.label, referral_codes.label),
        is_active  = true
  returning id into v_code_id;

  insert into admin_audit_log (actor_id, action, target_id, details)
  values (auth.uid(), 'upsert_referral_code', v_partner,
          jsonb_build_object('code', v_code, 'partner', trim(p_partner_name)));

  return v_code_id;
end;
$$;

revoke all on function admin_upsert_referral_code(text, text, text, text, text, text) from public, anon;
grant execute on function admin_upsert_referral_code(text, text, text, text, text, text) to authenticated;

create or replace function admin_set_referral_code_active(p_code text, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner uuid;
begin
  if not can_manage_referrals() then
    raise exception 'Not authorized';
  end if;

  update referral_codes
  set is_active = coalesce(p_active, false)
  where code = upper(trim(p_code))
  returning partner_id into v_partner;

  if not found then
    raise exception 'No such code';
  end if;

  insert into admin_audit_log (actor_id, action, target_id, details)
  values (auth.uid(),
          case when p_active then 'activate_referral_code' else 'retire_referral_code' end,
          v_partner,
          jsonb_build_object('code', upper(trim(p_code))));
end;
$$;

revoke all on function admin_set_referral_code_active(text, boolean) from public, anon;
grant execute on function admin_set_referral_code_active(text, boolean) to authenticated;
