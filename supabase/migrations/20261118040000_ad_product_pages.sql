-- Sponsored product pages. A Discover (or My products) ad can now open a
-- full product page instead of a link: about, how to use, cautions,
-- ingredients, "Add to My Products" and "Shop now" (the brand's own shop).
--
--   ad_placements.product  the page's content (jsonb, cleaned on save)
--   action 'product'       the ad opens that page
--   events 'shop_click'    tapped Shop now (left for the brand's shop)
--          'product_add'   saved the product to their Tracka+ products
-- Both new events are conversions: counted once per person per ad, like
-- challenge_join. The report shows them as totals and in each slot's
-- conversions.
--
-- Changes the return type of active_ads and the arguments of
-- admin_upsert_ad_placement, so both are dropped and recreated (with the
-- same grants). Ship order: this migration FIRST, then the app — the new
-- console sends p_product, which the old function doesn't accept.

alter table ad_placements add column if not exists product jsonb;

alter table ad_placements drop constraint if exists ad_placements_action_check;
alter table ad_placements add constraint ad_placements_action_check
  check (action in ('url', 'challenge', 'feature_guide', 'screen', 'product'));

alter table ad_events drop constraint if exists ad_events_event_check;
alter table ad_events add constraint ad_events_event_check
  check (event in ('impression', 'click', 'challenge_join', 'guide_complete', 'shop_click', 'product_add'));

-- ---------------------------------------------------------------- live ads

drop function if exists active_ads(text);
create function active_ads(p_slot text)
returns table (
  placement_id uuid, campaign_id uuid, brand text, is_house boolean,
  headline text, body text, cta_label text, image_url text,
  action text, action_target text, landing_url text, challenge_id uuid,
  product jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, c.id, b.name, b.is_house, p.headline, p.body, p.cta_label,
         p.image_url, p.action, p.action_target, c.landing_url, c.challenge_id,
         p.product
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

-- ---------------------------------------------------------------- events

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
  if p_event not in ('impression', 'click', 'challenge_join', 'guide_complete', 'shop_click', 'product_add') then
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
    when 'click' then interval '1 minute'
    else interval '100 years'   -- conversions: once per person per ad
  end;

  if exists (
    select 1 from ad_events e
    where e.user_id = auth.uid()
      and e.placement_id = p_placement_id
      and e.event = p_event
      and e.created_at > now() - v_window
      and (p_event <> 'impression' or e.local_date = v_today)
  ) then
    return;
  end if;

  insert into ad_events (placement_id, campaign_id, user_id, event, local_date)
  values (p_placement_id, v_campaign.id, auth.uid(), p_event, v_today);
end;
$$;

-- ---------------------------------------------------------------- saving

drop function if exists admin_upsert_ad_placement(uuid, uuid, text, text, text, text, text, text, text, boolean);
create function admin_upsert_ad_placement(
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
    v_product := jsonb_strip_nulls(jsonb_build_object(
      'name', trim(p_product->>'name'),
      'category', nullif(trim(p_product->>'category'), ''),
      'about', nullif(trim(p_product->>'about'), ''),
      'how_to_use', nullif(trim(p_product->>'how_to_use'), ''),
      'cautions', (
        select nullif(jsonb_agg(trim(x)), '[]'::jsonb)
        from jsonb_array_elements_text(coalesce(p_product->'cautions', '[]'::jsonb)) as x
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

revoke all on function admin_upsert_ad_placement(uuid, uuid, text, text, text, text, text, text, text, boolean, jsonb) from public, anon;
grant execute on function admin_upsert_ad_placement(uuid, uuid, text, text, text, text, text, text, text, boolean, jsonb) to authenticated;

-- The ads in one campaign, for the console — now with the product page.
create or replace function ad_campaign_placements(p_campaign_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_brand uuid;
begin
  select brand_id into v_brand from ad_campaigns where id = p_campaign_id;
  if v_brand is null or not can_view_ad_brand(v_brand) then
    raise exception 'Not authorized';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', p.id, 'slot', p.slot, 'headline', p.headline, 'body', p.body,
             'cta_label', p.cta_label, 'image_url', p.image_url, 'action', p.action,
             'action_target', p.action_target, 'is_active', p.is_active,
             'product', p.product
           ) order by p.created_at)
    from ad_placements p where p.campaign_id = p_campaign_id
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------- report

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
      'shop_clicks', (select count(*) from ev where event = 'shop_click'),
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
