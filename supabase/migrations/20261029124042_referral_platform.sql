-- Pulled verbatim from live (supabase_migrations.schema_migrations,
-- version 20261029124042) — the reviewer wrote and applied this directly.
-- Kept in the repo so future migrations don't silently revert it.

-- Referral platform: QR codes on flyers in stores and clinics, and an
-- admin-only report of what each one produced.
--
-- Two levels, one table each, because "one code per store, one per partner"
-- is a hierarchy rather than two systems: a partner is the business you did
-- the deal with, a code is the thing actually printed on a flyer. A partner
-- with one shop has one code; a chain gets a code per branch and the report
-- rolls them up. Tracka+'s own QR is just a partner of kind 'tracka' with
-- code TRACKA, so it appears in the same report with no special-casing.
--
-- Attribution is first-touch and permanent. The landing page mints a random
-- visitor_id into localStorage on the first ?ref= hit; at signup the client
-- hands it back and claim_referral() links it. One row per user, insert-only
-- — a later scan of a different store's code can never re-point an existing
-- user, which is what stops partners from poaching each other's credit.
--
-- Nothing here is readable by anon or authenticated. Scans must be recorded
-- before anyone has signed in, so record_referral_scan() is callable by anon,
-- but it's SECURITY DEFINER and validates the code: the tables stay closed.

create table if not exists referral_partners (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  kind        text not null default 'store'
              check (kind in ('store', 'clinic', 'spa', 'brand', 'online', 'event', 'tracka')),
  contact_name  text,
  contact_phone text,
  contact_email text,
  city        text,
  notes       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id)
);

create table if not exists referral_codes (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code = upper(code) and code ~ '^[A-Z0-9][A-Z0-9-]{1,23}$'),
  partner_id  uuid references referral_partners(id) on delete cascade,
  label       text,                       -- 'Lekki branch', 'Flyer batch 1'
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id)
);
create index if not exists referral_codes_partner_idx on referral_codes(partner_id);

create table if not exists referral_scans (
  id          bigint generated always as identity primary key,
  code_id     uuid not null references referral_codes(id) on delete cascade,
  visitor_id  uuid not null,
  scanned_at  timestamptz not null default now(),
  -- plain column, not generated: `at time zone <literal>` is stable, not
  -- immutable, so Postgres won't allow it in a generated column. Same shape
  -- as routine_step_completions.local_date.
  scan_date   date not null default ((now() at time zone 'Africa/Lagos')::date),
  user_agent  text
);
-- One scan per visitor per code per day: refreshing the landing page or
-- re-scanning the same flyer must not inflate a partner's numbers.
create unique index if not exists referral_scans_dedupe_idx
  on referral_scans(code_id, visitor_id, scan_date);
create index if not exists referral_scans_visitor_idx on referral_scans(visitor_id, scanned_at);

create table if not exists referral_attributions (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  code_id        uuid not null references referral_codes(id) on delete cascade,
  visitor_id     uuid not null,
  first_scan_at  timestamptz not null,
  attributed_at  timestamptz not null default now(),
  -- A partner should only be credited with a SIGNUP when the account didn't
  -- already exist. Existing users who scan still get attributed (useful to
  -- know a shop is reaching real users) but are counted separately.
  new_signup     boolean not null default true
);
create index if not exists referral_attributions_code_idx on referral_attributions(code_id);

alter table referral_partners     enable row level security;
alter table referral_codes        enable row level security;
alter table referral_scans        enable row level security;
alter table referral_attributions enable row level security;

-- No policies anywhere: every read and write goes through the functions below.
revoke all on referral_partners, referral_codes, referral_scans, referral_attributions
  from anon, authenticated;


-- Called by the landing page on a ?ref= hit, before the visitor has an
-- account. Returns the partner name so the page can say who sent them, or
-- null for an unknown/retired code (never an error — a bad code must not
-- break the landing page).
create or replace function record_referral_scan(p_code text, p_visitor uuid, p_user_agent text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code_id uuid;
  v_partner text;
begin
  if p_visitor is null then
    return jsonb_build_object('ok', false);
  end if;

  select rc.id, pt.name into v_code_id, v_partner
  from referral_codes rc
  left join referral_partners pt on pt.id = rc.partner_id
  where rc.code = upper(trim(p_code))
    and rc.is_active
    and (pt.id is null or pt.is_active);

  if v_code_id is null then
    return jsonb_build_object('ok', false);
  end if;

  insert into referral_scans (code_id, visitor_id, user_agent)
  values (v_code_id, p_visitor, left(p_user_agent, 300))
  on conflict (code_id, visitor_id, scan_date) do nothing;

  return jsonb_build_object('ok', true, 'partner', v_partner);
end;
$$;

revoke all on function record_referral_scan(text, uuid, text) from public;
grant execute on function record_referral_scan(text, uuid, text) to anon, authenticated;


-- Called once, just after signup, with the visitor_id from localStorage.
-- Insert-only by primary key, so calling it again (or scanning another code
-- later) silently keeps the original attribution.
create or replace function claim_referral(p_visitor uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_code uuid;
  v_first timestamptz;
  v_created timestamptz;
begin
  if v_user is null or p_visitor is null then
    return false;
  end if;

  select s.code_id, s.scanned_at into v_code, v_first
  from referral_scans s
  where s.visitor_id = p_visitor
  order by s.scanned_at asc
  limit 1;

  if v_code is null then
    return false;
  end if;

  select u.created_at into v_created from auth.users u where u.id = v_user;

  insert into referral_attributions (user_id, code_id, visitor_id, first_scan_at, new_signup)
  values (v_user, v_code, p_visitor, v_first, coalesce(v_created >= v_first, false))
  on conflict (user_id) do nothing;

  return found;
end;
$$;

revoke all on function claim_referral(uuid) from public, anon;
grant execute on function claim_referral(uuid) to authenticated;


-- The admin report: the funnel you named, per code, rolled up per partner.
-- scans -> signups -> onboarded -> logged a routine -> one perfect day.
--
-- "Perfect day" = a date on which they completed every routine they have,
-- not a hardcoded AM+PM: someone with a morning routine only would otherwise
-- never qualify.
create or replace function admin_referral_report()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not exists (
    select 1 from auth.users u
    where u.id = auth.uid() and u.email = 'trackaplusapp@gmail.com'
  ) then
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
  if not exists (
    select 1 from auth.users u
    where u.id = auth.uid() and u.email = 'trackaplusapp@gmail.com'
  ) then
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


-- Tracka+'s own QR, so the house code is reported like any partner.
insert into referral_partners (name, kind, city)
select 'Tracka+', 'tracka', 'Lagos'
where not exists (select 1 from referral_partners where name = 'Tracka+');

insert into referral_codes (code, partner_id, label)
select 'TRACKA', id, 'Tracka+ house QR'
from referral_partners where name = 'Tracka+'
  and not exists (select 1 from referral_codes where code = 'TRACKA');
