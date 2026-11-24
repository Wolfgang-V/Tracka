-- 30 Days of SPF with Ebun Derma: starts today (25 Nov) and is open to
-- people in Nigeria only.
--
-- How "in Nigeria" is decided. We don't store a country for anyone, so the
-- test is the phone's timezone: Nigeria's is Africa/Lagos. It's what the
-- device reports, so it's a good-enough filter for a sponsored giveaway, not
-- proof: a Nigerian travelling abroad is left out, and a few neighbouring
-- countries whose phones report Africa/Lagos would be let in. Winners can be
-- checked by hand (delivery address) before prizes go out; the timezone each
-- person joined with is now kept on challenge_participants for that.
--
--   1. challenges.countries (text[], ISO codes; null = open to everyone).
--   2. timezone_country(tz): 'Africa/Lagos' -> 'NG', else null.
--   3. challenge_participants.timezone: the timezone they joined with.
--   4. join_challenge takes an optional p_timezone (the app sends the
--      device's). For a country-limited challenge it falls back to the
--      timezone saved with reminders; if neither is known (an older app
--      build, no reminders set) the join is allowed rather than wrongly
--      blocked. Otherwise a non-Nigerian timezone gets NOT_IN_REGION.
--      ONLY changes from 20261124000000's version: the parameter, the
--      region check, and storing the timezone.
--   5. active_ads also returns the linked challenge's countries so the app
--      can hide that challenge's pop-ups outside Nigeria. (Return type
--      changes, so it's dropped and recreated; grants restored as before.)
--   6. The Ebun Derma challenge: 25 Nov - 24 Dec (still 30 days), NG only;
--      its campaign ends 24 Dec too. The 6 people who joined early had
--      start_date 28 Nov; they're moved to today and today is recounted.
--
-- Ship order: this migration FIRST, then the app. The current app keeps
-- working (it doesn't send p_timezone, which defaults to null, and ignores
-- the extra active_ads column). The app can't go first: it would send a
-- parameter join_challenge doesn't have yet, and every join would fail.

-- 1. Countries on a challenge -------------------------------------------------
alter table challenges add column if not exists countries text[];

-- 2. Timezone -> country --------------------------------------------------------
-- Not a general lookup: it only knows Nigeria (which has one timezone).
-- Adding a country means adding its timezone(s) here AND in
-- src/lib/core/region.js.
create or replace function public.timezone_country(p_tz text)
returns text
language sql
immutable
set search_path to 'public'
as $function$
  select case when p_tz = 'Africa/Lagos' then 'NG' end;
$function$;

-- 3. The timezone each participant joined with ----------------------------------
alter table challenge_participants add column if not exists timezone text;

-- 4. Joining --------------------------------------------------------------------
drop function if exists public.join_challenge(uuid, date);

create or replace function public.join_challenge(p_challenge_id uuid, p_local_date date, p_timezone text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
  v_challenge challenges%rowtype;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_tz text := nullif(btrim(p_timezone), '');
  v_id uuid;
begin
  if v_user is null then
    raise exception 'Not signed in';
  end if;

  select * into v_challenge from challenges where id = p_challenge_id and is_published;
  if not found then
    raise exception 'Challenge not found';
  end if;

  if p_local_date is null or p_local_date < v_today - 1 or p_local_date > v_today + 1 then
    raise exception 'Invalid date';
  end if;

  if v_challenge.ends_on is not null and p_local_date > v_challenge.ends_on then
    raise exception 'CHALLENGE_ENDED';
  end if;

  if exists (
    select 1 from challenge_participants
    where challenge_id = p_challenge_id
      and user_id = v_user
      and (
        status = 'active'
        or (status = 'completed' and v_challenge.ends_on is not null)
      )
  ) then
    raise exception 'ALREADY_JOINED';
  end if;

  if v_tz is null then
    select nullif(btrim(timezone), '') into v_tz from reminder_settings where user_id = v_user;
  end if;

  if v_challenge.countries is not null
     and cardinality(v_challenge.countries) > 0
     and v_tz is not null
     and not coalesce(timezone_country(v_tz) = any (v_challenge.countries), false) then
    raise exception 'NOT_IN_REGION';
  end if;

  if v_challenge.rule in ('am_sunscreen', 'am_pm_routines') and not exists (
    select 1
    from routines r
    join routine_steps rs on rs.routine_id = r.id
    join user_products up on up.id = rs.user_product_id
    join products p on p.id = up.product_id
    where r.user_id = v_user
      and r.is_active
      and rs.is_active
      and r.time_of_day = 'AM'
      and lower(p.category) = 'sunscreen'
  ) then
    raise exception 'NO_SUNSCREEN_STEP';
  end if;

  insert into challenge_participants (challenge_id, user_id, start_date, timezone)
  values (p_challenge_id, v_user, greatest(p_local_date, coalesce(v_challenge.starts_on, p_local_date)), v_tz)
  returning id into v_id;

  perform refresh_challenge_progress(v_user, p_local_date);

  return v_id;
end;
$function$;

revoke all on function public.join_challenge(uuid, date, text) from public, anon;
grant execute on function public.join_challenge(uuid, date, text) to authenticated, service_role;

-- 5. Ads carry the linked challenge's countries ---------------------------------
drop function if exists public.active_ads(text);

create or replace function public.active_ads(p_slot text)
returns table(placement_id uuid, campaign_id uuid, brand text, is_house boolean, headline text, body text,
              cta_label text, image_url text, action text, action_target text, landing_url text,
              challenge_id uuid, product jsonb, countries text[])
language sql
stable security definer
set search_path to 'public'
as $function$
  select p.id, c.id, b.name, b.is_house, p.headline, p.body, p.cta_label,
         p.image_url, p.action, p.action_target, c.landing_url, c.challenge_id,
         p.product, ch.countries
  from ad_placements p
  join ad_campaigns c on c.id = p.campaign_id
  join ad_brands b on b.id = c.brand_id
  left join challenges ch on ch.id = c.challenge_id
  where p.slot = p_slot
    and p.is_active
    and c.status = 'active'
    and (now() at time zone 'Africa/Lagos')::date between c.starts_on and c.ends_on
  order by p.priority desc, p.created_at desc;
$function$;

revoke all on function public.active_ads(text) from public, anon;
grant execute on function public.active_ads(text) to authenticated, service_role;

-- 6. The Ebun Derma challenge ---------------------------------------------------
update challenges set
  starts_on = date '2026-11-25',
  ends_on   = date '2026-12-24',
  countries = array['NG']
where id = 'e8d0a5f1-3c2b-4d7e-9a61-2f5b8c4d0e01';

update ad_campaigns set ends_on = date '2026-12-24'
where id = 'e8d0a5f1-3c2b-4d7e-9a61-2f5b8c4d0e02';

-- Early joiners start today, with the timezone we already know for them.
update challenge_participants cp set
  start_date = date '2026-11-25',
  timezone = coalesce(cp.timezone, (select nullif(btrim(rs.timezone), '') from reminder_settings rs where rs.user_id = cp.user_id))
where cp.challenge_id = 'e8d0a5f1-3c2b-4d7e-9a61-2f5b8c4d0e01'
  and cp.start_date > date '2026-11-25';

-- Count today for them (someone may already have done both routines).
do $$
declare
  r record;
begin
  for r in
    select user_id from challenge_participants
    where challenge_id = 'e8d0a5f1-3c2b-4d7e-9a61-2f5b8c4d0e01'
  loop
    perform refresh_challenge_progress(r.user_id, date '2026-11-25');
  end loop;
end $$;
