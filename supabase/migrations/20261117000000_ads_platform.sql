-- Sponsored placements + campaign analytics.
--
-- Shape: ad_brands → ad_campaigns → ad_placements (one ad in one slot)
-- → ad_events (impression / click / conversion rows, insert-only).
--
-- Built for brand self-service from day one: a brand has members
-- (ad_brand_members), and every report goes through ONE check,
-- can_view_ad_brand(). Today only the admin passes it (brands have no
-- logins yet); later a brand's own staff get member rows and see their own
-- campaigns — no report function changes. Creating / editing stays with
-- can_manage_ads() (admin).
--
-- All tables are closed (RLS on, no policies); everything goes through the
-- functions below, like the referral platform.
--
-- Seeds the first house campaign: "Get to know Tracka+", a Today banner
-- that opens the in-app feature guide.

-- ---------------------------------------------------------------- tables

create table if not exists ad_brands (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  website text,
  contact_email text,
  is_house boolean not null default false,   -- Tracka+'s own promotions
  created_at timestamptz not null default now()
);

create table if not exists ad_brand_members (
  brand_id uuid not null references ad_brands(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'viewer' check (role in ('viewer', 'manager')),
  added_at timestamptz not null default now(),
  primary key (brand_id, user_id)
);

create table if not exists ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references ad_brands(id) on delete cascade,
  name text not null,
  objective text,
  starts_on date not null,
  ends_on date not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'ended')),
  landing_url text,
  challenge_id uuid references challenges(id) on delete set null,  -- sponsored challenge, if any
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);

create table if not exists ad_placements (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references ad_campaigns(id) on delete cascade,
  slot text not null check (slot in ('home_banner', 'sponsored_challenge', 'product_card')),
  headline text not null,
  body text,
  cta_label text,
  image_url text,
  -- What a tap does: open a URL (UTM-tagged by the app), a challenge, or
  -- an in-app screen such as the feature guide.
  action text not null check (action in ('url', 'challenge', 'feature_guide', 'screen')),
  action_target text,
  priority integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists ad_events (
  id bigint generated always as identity primary key,
  placement_id uuid not null references ad_placements(id) on delete cascade,
  campaign_id uuid not null references ad_campaigns(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  event text not null check (event in ('impression', 'click', 'challenge_join', 'guide_complete')),
  local_date date not null,
  created_at timestamptz not null default now()
);

create index if not exists ad_events_campaign_date on ad_events (campaign_id, local_date);
create index if not exists ad_events_dedupe on ad_events (user_id, placement_id, event, created_at desc);
create index if not exists ad_campaigns_brand on ad_campaigns (brand_id);
create index if not exists ad_placements_campaign on ad_placements (campaign_id);

alter table ad_brands enable row level security;
alter table ad_brand_members enable row level security;
alter table ad_campaigns enable row level security;
alter table ad_placements enable row level security;
alter table ad_events enable row level security;

-- ---------------------------------------------------------------- access

create or replace function can_manage_ads()
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

-- The ONE report check: admin, or a member of that brand.
create or replace function can_view_ad_brand(p_brand_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select can_manage_ads()
      or exists (
        select 1 from ad_brand_members m
        where m.brand_id = p_brand_id and m.user_id = auth.uid()
      );
$$;

revoke all on function can_manage_ads() from public, anon;
grant execute on function can_manage_ads() to authenticated;
revoke all on function can_view_ad_brand(uuid) from public, anon;
grant execute on function can_view_ad_brand(uuid) to authenticated;

-- ---------------------------------------------------------------- serving

-- Live ads for one slot, for the signed-in user. Live = placement active,
-- campaign 'active', and today (Lagos) inside the campaign dates.
create or replace function active_ads(p_slot text)
returns table (
  placement_id uuid,
  campaign_id uuid,
  brand text,
  is_house boolean,
  headline text,
  body text,
  cta_label text,
  image_url text,
  action text,
  action_target text,
  landing_url text,
  challenge_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, c.id, b.name, b.is_house, p.headline, p.body, p.cta_label,
         p.image_url, p.action, p.action_target, c.landing_url, c.challenge_id
  from ad_placements p
  join ad_campaigns c on c.id = p.campaign_id
  join ad_brands b on b.id = c.brand_id
  where p.slot = p_slot
    and p.is_active
    and c.status = 'active'
    and (now() at time zone 'Africa/Lagos')::date between c.starts_on and c.ends_on
  order by p.priority desc, p.created_at desc;
$$;

revoke all on function active_ads(text) from public, anon;
grant execute on function active_ads(text) to authenticated;

-- One event from the app. Impressions are counted at most once per person
-- per ad per 30 minutes (a re-render or scrolling back up doesn't inflate
-- the number brands see); clicks once per 2 seconds (double taps).
-- Impressions and clicks only count while the campaign is live;
-- conversions (challenge_join, guide_complete) count shortly after too.
create or replace function record_ad_event(p_placement_id uuid, p_event text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign ad_campaigns%rowtype;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_window interval;
begin
  if auth.uid() is null then
    return;
  end if;
  if p_event not in ('impression', 'click', 'challenge_join', 'guide_complete') then
    raise exception 'Unknown ad event';
  end if;

  select c.* into v_campaign
  from ad_placements p join ad_campaigns c on c.id = p.campaign_id
  where p.id = p_placement_id;
  if not found then
    return;
  end if;

  if p_event in ('impression', 'click') then
    if v_campaign.status <> 'active' or v_today not between v_campaign.starts_on and v_campaign.ends_on then
      return;
    end if;
  elsif v_today > v_campaign.ends_on + 7 then
    return;
  end if;

  v_window := case p_event
    when 'impression' then interval '30 minutes'
    when 'click' then interval '2 seconds'
    else interval '100 years'   -- conversions: once per person per ad
  end;

  if exists (
    select 1 from ad_events e
    where e.user_id = auth.uid()
      and e.placement_id = p_placement_id
      and e.event = p_event
      and e.created_at > now() - v_window
  ) then
    return;
  end if;

  insert into ad_events (placement_id, campaign_id, user_id, event, local_date)
  values (p_placement_id, v_campaign.id, auth.uid(), p_event, v_today);
end;
$$;

revoke all on function record_ad_event(uuid, text) from public, anon;
grant execute on function record_ad_event(uuid, text) to authenticated;

-- ---------------------------------------------------------------- console

-- Brands (with their campaigns) the caller may see. Admin: all.
-- A brand member: only their brand(s).
create or replace function ad_console_brands()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', b.id,
           'name', b.name,
           'is_house', b.is_house,
           'website', b.website,
           'campaigns', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', c.id, 'name', c.name, 'status', c.status,
                      'starts_on', c.starts_on, 'ends_on', c.ends_on,
                      'objective', c.objective, 'landing_url', c.landing_url,
                      'challenge_id', c.challenge_id
                    ) order by c.starts_on desc)
             from ad_campaigns c where c.brand_id = b.id
           ), '[]'::jsonb)
         ) order by b.is_house, b.name), '[]'::jsonb)
  from ad_brands b
  where can_view_ad_brand(b.id);
$$;

revoke all on function ad_console_brands() from public, anon;
grant execute on function ad_console_brands() to authenticated;

-- Campaign performance for one brand over a date range (Lagos days),
-- optionally narrowed to one campaign. Totals, a zero-filled day series
-- and a per-slot breakdown. Reach = distinct people who had an impression.
create or replace function ad_campaign_report(
  p_brand_id uuid,
  p_campaign_id uuid default null,
  p_from date default null,
  p_to date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_to date := coalesce(p_to, (now() at time zone 'Africa/Lagos')::date);
  v_from date := coalesce(p_from, v_to - 29);
  v_result jsonb;
begin
  if not can_view_ad_brand(p_brand_id) then
    raise exception 'Not authorized';
  end if;
  if v_to - v_from > 366 then
    v_from := v_to - 366;
  end if;

  with camps as (
    select c.id, c.challenge_id from ad_campaigns c
    where c.brand_id = p_brand_id
      and (p_campaign_id is null or c.id = p_campaign_id)
  ),
  ev as (
    select e.*, p.slot from ad_events e
    join ad_placements p on p.id = e.placement_id
    where e.campaign_id in (select id from camps)
      and e.local_date between v_from and v_to
  ),
  days as (
    select generate_series(v_from, v_to, interval '1 day')::date as d
  ),
  -- Every sign-up to a sponsored challenge in the period, whether or not
  -- it came through an ad (the ad-attributed subset is challenge_join).
  joins as (
    select count(*) as n from challenge_participants cp
    where cp.challenge_id in (select challenge_id from camps where challenge_id is not null)
      and (cp.joined_at at time zone 'Africa/Lagos')::date between v_from and v_to
  )
  select jsonb_build_object(
    'from', v_from,
    'to', v_to,
    'totals', jsonb_build_object(
      'impressions', (select count(*) from ev where event = 'impression'),
      'reach', (select count(distinct user_id) from ev where event = 'impression'),
      'clicks', (select count(*) from ev where event = 'click'),
      'clickers', (select count(distinct user_id) from ev where event = 'click'),
      'challenge_joins_from_ads', (select count(*) from ev where event = 'challenge_join'),
      'challenge_joins_total', (select n from joins),
      'guide_completes', (select count(*) from ev where event = 'guide_complete')
    ),
    'by_day', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'date', days.d,
               'impressions', (select count(*) from ev where ev.local_date = days.d and event = 'impression'),
               'reach', (select count(distinct user_id) from ev where ev.local_date = days.d and event = 'impression'),
               'clicks', (select count(*) from ev where ev.local_date = days.d and event = 'click')
             ) order by days.d), '[]'::jsonb)
      from days
    ),
    'by_slot', (
      select coalesce(jsonb_agg(s order by s->>'slot'), '[]'::jsonb) from (
        select jsonb_build_object(
          'slot', slot,
          'impressions', count(*) filter (where event = 'impression'),
          'reach', count(distinct user_id) filter (where event = 'impression'),
          'clicks', count(*) filter (where event = 'click'),
          'conversions', count(*) filter (where event in ('challenge_join', 'guide_complete'))
        ) as s
        from ev group by slot
      ) x
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function ad_campaign_report(uuid, uuid, date, date) from public, anon;
grant execute on function ad_campaign_report(uuid, uuid, date, date) to authenticated;

-- Pause / resume / end a campaign (admin). Audited.
create or replace function admin_set_ad_campaign_status(p_campaign_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not can_manage_ads() then
    raise exception 'Not authorized';
  end if;
  if p_status not in ('draft', 'active', 'paused', 'ended') then
    raise exception 'Unknown status';
  end if;

  update ad_campaigns set status = p_status where id = p_campaign_id;
  if not found then
    raise exception 'No such campaign';
  end if;

  insert into admin_audit_log (actor_id, action, target_id, details)
  values (auth.uid(), 'set_ad_campaign_status', p_campaign_id, jsonb_build_object('status', p_status));
end;
$$;

revoke all on function admin_set_ad_campaign_status(uuid, text) from public, anon;
grant execute on function admin_set_ad_campaign_status(uuid, text) to authenticated;

-- ---------------------------------------------------------------- seed

insert into ad_brands (name, website, is_house)
values ('Tracka+', 'https://trackaplus.app', true)
on conflict (name) do nothing;

insert into ad_campaigns (brand_id, name, objective, starts_on, ends_on, status)
select b.id, 'Get to know Tracka+', 'Feature guide: show people everything the app does',
       (now() at time zone 'Africa/Lagos')::date,
       (now() at time zone 'Africa/Lagos')::date + 60,
       'active'
from ad_brands b
where b.name = 'Tracka+'
  and not exists (select 1 from ad_campaigns c where c.brand_id = b.id and c.name = 'Get to know Tracka+');

insert into ad_placements (campaign_id, slot, headline, body, cta_label, action, priority)
select c.id, 'home_banner', 'Get the most out of Tracka+',
       'A 2-minute tour of everything Tracka+ can do for your skin.',
       'Take the tour', 'feature_guide', 0
from ad_campaigns c
where c.name = 'Get to know Tracka+'
  and not exists (select 1 from ad_placements p where p.campaign_id = c.id and p.slot = 'home_banner');
