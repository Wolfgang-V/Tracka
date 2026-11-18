-- Synced from live (applied by the reviewer as 20261118020714
-- ad_cautions_guard_and_shop_clickers). Two follow-ups to sponsored
-- product pages.
--
-- 1. cautions type guard. jsonb_array_elements_text() raises a raw Postgres
--    error ("cannot extract elements from a scalar") if cautions arrives as
--    a string or object rather than a list, instead of one of this
--    function's own messages. Checked before the list is built. A null
--    cautions is treated as absent, not rejected.
--
-- 2. totals.shop_clicks -> totals.shop_clickers. shop_click falls through
--    to the 100-year window, so it is one per person per ad, ever — while
--    totals.clicks beside it is every tap. The name now says which it is.
--    product_adds keeps its name: a person can only add a product once, so
--    the per-person count and the event count are the same number.
--
-- Both are create-or-replace at the same signatures, so grants carry over.

create or replace function admin_upsert_ad_placement(
  p_id uuid,
  p_campaign_id uuid,
  p_slot text,
  p_headline text,
  p_body text,
  p_cta_label text,
  p_image_url text,
  p_action text,
  p_action_target text,
  p_is_active boolean default true,
  p_product jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_campaign ad_campaigns%rowtype;
  v_product jsonb;
begin
  if not can_manage_ads() then
    raise exception 'Not authorized';
  end if;
  select * into v_campaign from ad_campaigns where id = p_campaign_id;
  if not found then
    raise exception 'No such campaign';
  end if;
  if coalesce(trim(p_headline), '') = '' then
    raise exception 'A headline is required';
  end if;
  if p_slot = 'sponsored_challenge' and v_campaign.challenge_id is null then
    raise exception 'Pick the sponsored challenge on the campaign first';
  end if;
  if p_action = 'url'
     and coalesce(nullif(trim(p_action_target), ''), v_campaign.landing_url) is null then
    raise exception 'Add a link for the button (or a landing page on the campaign)';
  end if;
  if p_action = 'url' and nullif(trim(p_action_target), '') is not null and p_action_target !~* '^https?://' then
    raise exception 'The link must start with http:// or https://';
  end if;
  -- Images come from the ad-images bucket (or another https URL). Plain
  -- http is allowed only for a local development copy of the database.
  if nullif(trim(p_image_url), '') is not null
     and p_image_url !~* '^(https://|http://(127\.0\.0\.1|localhost)[:/])' then
    raise exception 'The image must be an https link';
  end if;

  -- Product page: keep only the fields the app shows, trimmed; cautions
  -- become a clean list of non-empty lines.
  if p_action = 'product' then
    if coalesce(trim(p_product->>'name'), '') = '' then
      raise exception 'Add the product name';
    end if;
    if nullif(trim(p_product->>'shop_url'), '') is not null and p_product->>'shop_url' !~* '^https://' then
      raise exception 'The shop link must start with https://';
    end if;
    -- Must be a list, or jsonb_array_elements_text below raises a raw
    -- Postgres error instead of this message.
    if p_product ? 'cautions'
       and jsonb_typeof(p_product->'cautions') not in ('array', 'null') then
      raise exception 'Cautions must be a list';
    end if;
    v_product := jsonb_strip_nulls(jsonb_build_object(
      'name', trim(p_product->>'name'),
      'category', nullif(trim(p_product->>'category'), ''),
      'about', nullif(trim(p_product->>'about'), ''),
      'how_to_use', nullif(trim(p_product->>'how_to_use'), ''),
      'cautions', (
        select nullif(jsonb_agg(trim(x)), '[]'::jsonb)
        from jsonb_array_elements_text(
               case when jsonb_typeof(p_product->'cautions') = 'array'
                    then p_product->'cautions' else '[]'::jsonb end) as x
        where trim(x) <> ''
      ),
      'ingredients', nullif(trim(p_product->>'ingredients'), ''),
      'shop_url', nullif(trim(p_product->>'shop_url'), '')
    ));
  end if;

  if p_id is null then
    insert into ad_placements (campaign_id, slot, headline, body, cta_label, image_url, action, action_target, is_active, product)
    values (p_campaign_id, p_slot, trim(p_headline), nullif(trim(p_body), ''), nullif(trim(p_cta_label), ''),
            nullif(trim(p_image_url), ''), p_action, nullif(trim(p_action_target), ''), coalesce(p_is_active, true), v_product)
    returning id into v_id;
  else
    update ad_placements
    set slot = p_slot,
        headline = trim(p_headline),
        body = nullif(trim(p_body), ''),
        cta_label = nullif(trim(p_cta_label), ''),
        image_url = nullif(trim(p_image_url), ''),
        action = p_action,
        action_target = nullif(trim(p_action_target), ''),
        is_active = coalesce(p_is_active, true),
        product = v_product
    where id = p_id and campaign_id = p_campaign_id
    returning id into v_id;
    if v_id is null then
      raise exception 'No such ad';
    end if;
  end if;

  insert into admin_audit_log (actor_id, action, target_id, details)
  values (auth.uid(), case when p_id is null then 'create_ad_placement' else 'update_ad_placement' end,
          v_id, jsonb_build_object('campaign_id', p_campaign_id, 'slot', p_slot, 'is_active', coalesce(p_is_active, true)));
  return v_id;
end;
$$;

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
    where c.brand_id = p_brand_id and (p_campaign_id is null or c.id = p_campaign_id)
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
      'guide_completes', (select count(*) from ev where event = 'guide_complete'),
      'shop_clickers', (select count(*) from ev where event = 'shop_click'),
      'product_adds', (select count(*) from ev where event = 'product_add')
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
          'conversions', count(*) filter (where event in ('challenge_join', 'guide_complete', 'shop_click', 'product_add'))
        ) as s
        from ev group by slot
      ) x
    )
  ) into v_result;

  return v_result;
end;
$$;
