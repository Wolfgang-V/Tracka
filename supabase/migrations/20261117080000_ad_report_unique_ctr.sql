-- Ads report: per-person click counts, and a cheaper day series.
--
-- 1. CTR. Clicks ÷ impressions could pass 100% (a tap inside the first
--    second, before the impression timer, or a second tap after the click
--    window). The console now shows unique CTR — people who clicked ÷ people
--    reached — so each day and each placement also returns `clickers`.
--    (The app also records an impression with every click, so clickers are
--    always a subset of reach.)
-- 2. by_day was three correlated subqueries per day (reviewer note: ~1,100
--    passes at the 366-day cap). Now one grouped pass, left-joined onto the
--    zero-filled days.
--
-- Same signature and grants; only the body changes.

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
  per_day as (
    select local_date as d,
           count(*) filter (where event = 'impression') as impressions,
           count(distinct user_id) filter (where event = 'impression') as reach,
           count(*) filter (where event = 'click') as clicks,
           count(distinct user_id) filter (where event = 'click') as clickers
    from ev group by local_date
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
               'impressions', coalesce(p.impressions, 0),
               'reach', coalesce(p.reach, 0),
               'clicks', coalesce(p.clicks, 0),
               'clickers', coalesce(p.clickers, 0)
             ) order by days.d), '[]'::jsonb)
      from days left join per_day p on p.d = days.d
    ),
    'by_slot', (
      select coalesce(jsonb_agg(s order by s->>'slot'), '[]'::jsonb) from (
        select jsonb_build_object(
          'slot', slot,
          'impressions', count(*) filter (where event = 'impression'),
          'reach', count(distinct user_id) filter (where event = 'impression'),
          'clicks', count(*) filter (where event = 'click'),
          'clickers', count(distinct user_id) filter (where event = 'click'),
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
