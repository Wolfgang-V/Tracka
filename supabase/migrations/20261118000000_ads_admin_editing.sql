-- Ads console: create and edit brands, campaigns and ads from admin, plus a
-- place for ad images.
--
-- Everything here is admin-only (can_manage_ads) and audited. New campaigns
-- start as 'draft', so nothing reaches users until someone presses
-- Activate (admin_set_ad_campaign_status, already live).
--
-- Brand self-service later: the read function below goes through
-- can_view_ad_brand like the reports, so a brand member will be able to
-- see their own ads; the write functions stay admin-only.
--
-- App needs this BEFORE the console update that calls these functions.

-- ---------------------------------------------------------------- brands

create or replace function admin_upsert_ad_brand(
  p_id uuid,
  p_name text,
  p_website text default null,
  p_contact_email text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not can_manage_ads() then
    raise exception 'Not authorized';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Brand name is required';
  end if;

  if p_id is null then
    insert into ad_brands (name, website, contact_email)
    values (trim(p_name), nullif(trim(p_website), ''), nullif(trim(p_contact_email), ''))
    returning id into v_id;
  else
    update ad_brands
    set name = trim(p_name),
        website = nullif(trim(p_website), ''),
        contact_email = nullif(trim(p_contact_email), '')
    where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'No such brand';
    end if;
  end if;

  insert into admin_audit_log (actor_id, action, target_id, details)
  values (auth.uid(), case when p_id is null then 'create_ad_brand' else 'update_ad_brand' end,
          v_id, jsonb_build_object('name', trim(p_name)));
  return v_id;
end;
$$;

revoke all on function admin_upsert_ad_brand(uuid, text, text, text) from public, anon;
grant execute on function admin_upsert_ad_brand(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------- campaigns

create or replace function admin_upsert_ad_campaign(
  p_id uuid,
  p_brand_id uuid,
  p_name text,
  p_objective text,
  p_starts_on date,
  p_ends_on date,
  p_landing_url text default null,
  p_challenge_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not can_manage_ads() then
    raise exception 'Not authorized';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Campaign name is required';
  end if;
  if p_starts_on is null or p_ends_on is null or p_ends_on < p_starts_on then
    raise exception 'The end date must be on or after the start date';
  end if;
  if nullif(trim(p_landing_url), '') is not null and p_landing_url !~* '^https?://' then
    raise exception 'The landing page must start with http:// or https://';
  end if;

  if p_id is null then
    insert into ad_campaigns (brand_id, name, objective, starts_on, ends_on, status, landing_url, challenge_id)
    values (p_brand_id, trim(p_name), nullif(trim(p_objective), ''), p_starts_on, p_ends_on, 'draft',
            nullif(trim(p_landing_url), ''), p_challenge_id)
    returning id into v_id;
  else
    -- Status is changed only through admin_set_ad_campaign_status.
    update ad_campaigns
    set name = trim(p_name),
        objective = nullif(trim(p_objective), ''),
        starts_on = p_starts_on,
        ends_on = p_ends_on,
        landing_url = nullif(trim(p_landing_url), ''),
        challenge_id = p_challenge_id
    where id = p_id and brand_id = p_brand_id
    returning id into v_id;
    if v_id is null then
      raise exception 'No such campaign';
    end if;
  end if;

  insert into admin_audit_log (actor_id, action, target_id, details)
  values (auth.uid(), case when p_id is null then 'create_ad_campaign' else 'update_ad_campaign' end,
          v_id, jsonb_build_object('name', trim(p_name), 'starts_on', p_starts_on, 'ends_on', p_ends_on));
  return v_id;
end;
$$;

revoke all on function admin_upsert_ad_campaign(uuid, uuid, text, text, date, date, text, uuid) from public, anon;
grant execute on function admin_upsert_ad_campaign(uuid, uuid, text, text, date, date, text, uuid) to authenticated;

-- ---------------------------------------------------------------- ads (placements)

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
  p_is_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_campaign ad_campaigns%rowtype;
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

  if p_id is null then
    insert into ad_placements (campaign_id, slot, headline, body, cta_label, image_url, action, action_target, is_active)
    values (p_campaign_id, p_slot, trim(p_headline), nullif(trim(p_body), ''), nullif(trim(p_cta_label), ''),
            nullif(trim(p_image_url), ''), p_action, nullif(trim(p_action_target), ''), coalesce(p_is_active, true))
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
        is_active = coalesce(p_is_active, true)
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

revoke all on function admin_upsert_ad_placement(uuid, uuid, text, text, text, text, text, text, text, boolean) from public, anon;
grant execute on function admin_upsert_ad_placement(uuid, uuid, text, text, text, text, text, text, text, boolean) to authenticated;

-- The ads in one campaign, for the console (same access rule as reports).
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
             'action_target', p.action_target, 'is_active', p.is_active
           ) order by p.created_at)
    from ad_placements p where p.campaign_id = p_campaign_id
  ), '[]'::jsonb);
end;
$$;

revoke all on function ad_campaign_placements(uuid) from public, anon;
grant execute on function ad_campaign_placements(uuid) to authenticated;

-- ---------------------------------------------------------------- images

-- Ad creatives are public by nature (they're shown in the app), so the
-- bucket is public-read; only the admin can upload, replace or delete.
insert into storage.buckets (id, name, public)
values ('ad-images', 'ad-images', true)
on conflict (id) do nothing;

drop policy if exists "Admin uploads ad images" on storage.objects;
drop policy if exists "Admin updates ad images" on storage.objects;
drop policy if exists "Admin deletes ad images" on storage.objects;

create policy "Admin uploads ad images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'ad-images' and can_manage_ads());

create policy "Admin updates ad images"
  on storage.objects for update to authenticated
  using (bucket_id = 'ad-images' and can_manage_ads())
  with check (bucket_id = 'ad-images' and can_manage_ads());

create policy "Admin deletes ad images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'ad-images' and can_manage_ads());

-- Console brand list: add contact_email so editing a brand keeps it.
-- (Otherwise identical to the version in 20261117000000_ads_platform.)
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
           'contact_email', b.contact_email,
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
