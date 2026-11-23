-- "30 Days of SPF with Ebun Derma": same format as 30 Days of SPF (spf-30),
-- sponsored by Ebun Derma, with 5 full-screen pop-up ads for the run.
--
-- Challenge: rule am_sunscreen (tick a sunscreen step in the AM routine),
-- 30-day shared window 28 Nov – 27 Dec 2026, over the line at 25 days,
-- missed days fine, winners after it closes (same as spf-30). Prize not
-- decided yet, so the copy says "Prizes from Ebun Derma for our top
-- finishers"; update description when it is.
--
-- Ads: new campaign under the existing Ebunderma brand, linked to the
-- challenge (so joins from the ads are credited), running 24 Nov (so people
-- can join before it starts) to 27 Dec. Five placements in the 'fullscreen'
-- slot, one per photo; FullscreenAd rotates them, one per day. Four open the
-- challenge; the product shot opens the SPF 50 product page (product details
-- copied from the existing "SPF 50 launch" Discover placement).
--
-- Photos are served by the app from /ads/ebun-derma/ (public/ in the repo).
--
-- Also changes join_challenge (section 0) so people can join before a
-- challenge's start date. Affects every challenge with a start date, but
-- the only one in the future is this one.
--
-- Ship order:
--   1. Deploy the app FIRST (it carries the photos and the daily rotation).
--   2. Then this migration.
--   3. Then switch full-screen ads ON in Admin (the "Full-screen ads" card).
--      The 'fullscreen_ads' flag has been off since 2026-11-17; nothing
--      pops up until it's on, and switching it off again stops them at once.

-- 0. Let people join before a challenge starts ------------------------------
-- The pop-ups run from 24 Nov so people can sign up ahead of the 28 Nov
-- start, but join_challenge refused any join before starts_on
-- (CHALLENGE_NOT_STARTED). The app already handles early joiners ("Starting
-- soon" in My challenges), and refresh_challenge_progress only counts days
-- from starts_on, so nothing is counted early. Only change from the live
-- definition (pulled 2026-11-23): that check is gone, and an early joiner's
-- start_date is the challenge's start date.
create or replace function public.join_challenge(p_challenge_id uuid, p_local_date date)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
  v_challenge challenges%rowtype;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
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

  if v_challenge.rule = 'am_sunscreen' and not exists (
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

  insert into challenge_participants (challenge_id, user_id, start_date)
  values (p_challenge_id, v_user, greatest(p_local_date, coalesce(v_challenge.starts_on, p_local_date)))
  returning id into v_id;

  perform refresh_challenge_progress(v_user, p_local_date);

  return v_id;
end;
$function$;

-- 1. Challenge --------------------------------------------------------------
insert into challenges (id, slug, title, tagline, description, active_subtitle, goal_text, rule,
                        duration_days, target_days, starts_on, ends_on, image_url, sponsor_name, is_published)
values (
  'e8d0a5f1-3c2b-4d7e-9a61-2f5b8c4d0e01',
  'ebun-derma-spf-30',
  '30 Days of SPF with Ebun Derma',
  'Protect your skin every morning for 30 days.',
  'Make sunscreen a daily habit. Apply sunscreen in your morning routine and tick it off in Tracka+. '
    || 'Reach 25 of the 30 days to cross the finish line. Missed a day? Keep going. '
    || 'Prizes from Ebun Derma for our top finishers.',
  'Your daily shield starts here.',
  'Complete the sunscreen step in your morning routine.',
  'am_sunscreen',
  30, 25, '2026-11-28', '2026-12-27',
  'https://www.trackaplus.app/ads/ebun-derma/applying.jpg',
  'Ebun Derma',
  true
)
on conflict (id) do nothing;

-- 2. Campaign ---------------------------------------------------------------
-- The brand's own spelling (it's on the packaging): pop-ups and the Discover
-- card label it "Sponsored · <brand name>".
update ad_brands set name = 'Ebun Derma' where id = '6ec9a787-696f-4fca-8090-c77b8d582c04';

insert into ad_campaigns (id, brand_id, name, objective, starts_on, ends_on, status, landing_url, challenge_id)
values (
  'e8d0a5f1-3c2b-4d7e-9a61-2f5b8c4d0e02',
  '6ec9a787-696f-4fca-8090-c77b8d582c04', -- Ebunderma
  '30 Days of SPF with Ebun Derma',
  'Sponsored challenge: sign-ups and daily sunscreen habit, plus SPF 50 product interest',
  '2026-11-24', '2026-12-27', 'active',
  'https://ebunderma.com/product/spf-50/',
  'e8d0a5f1-3c2b-4d7e-9a61-2f5b8c4d0e01'
)
on conflict (id) do nothing;

-- 3. Five full-screen pop-ups ---------------------------------------------
insert into ad_placements (id, campaign_id, slot, headline, body, cta_label, image_url, action, action_target, priority, is_active, product)
values
  ('e8d0a5f1-3c2b-4d7e-9a61-2f5b8c4d0e11', 'e8d0a5f1-3c2b-4d7e-9a61-2f5b8c4d0e02', 'fullscreen',
   'Your skin''s daily shield',
   'Join 30 Days of SPF with Ebun Derma. Wear sunscreen every morning, tick it off in Tracka+, and win prizes.',
   'Join the challenge', 'https://www.trackaplus.app/ads/ebun-derma/applying.jpg',
   'challenge', 'e8d0a5f1-3c2b-4d7e-9a61-2f5b8c4d0e01', 0, true, null),

  ('e8d0a5f1-3c2b-4d7e-9a61-2f5b8c4d0e12', 'e8d0a5f1-3c2b-4d7e-9a61-2f5b8c4d0e02', 'fullscreen',
   'Sunscreen is for everyone',
   'Melanin-rich skin needs SPF too. Take on 30 Days of SPF with Ebun Derma, together.',
   'Join the challenge', 'https://www.trackaplus.app/ads/ebun-derma/couple.jpg',
   'challenge', 'e8d0a5f1-3c2b-4d7e-9a61-2f5b8c4d0e01', 0, true, null),

  ('e8d0a5f1-3c2b-4d7e-9a61-2f5b8c4d0e13', 'e8d0a5f1-3c2b-4d7e-9a61-2f5b8c4d0e02', 'fullscreen',
   'Meet your daily SPF',
   'Ebun Derma Daily Skin Protector SPF50+ PA+++. Non-sticky, soft lotion texture, works under makeup.',
   'See the product', 'https://www.trackaplus.app/ads/ebun-derma/tubes.jpg',
   'product', null, 0, true,
   (select product from ad_placements where id = 'ce6604b6-c68e-488c-b2f5-839c52306649')),

  ('e8d0a5f1-3c2b-4d7e-9a61-2f5b8c4d0e14', 'e8d0a5f1-3c2b-4d7e-9a61-2f5b8c4d0e02', 'fullscreen',
   '30 days. One habit.',
   'Sunscreen every morning for 30 days. Reach 25 to cross the finish line. Missed a day? Keep going.',
   'Join the challenge', 'https://www.trackaplus.app/ads/ebun-derma/boxes.jpg',
   'challenge', 'e8d0a5f1-3c2b-4d7e-9a61-2f5b8c4d0e01', 0, true, null),

  ('e8d0a5f1-3c2b-4d7e-9a61-2f5b8c4d0e15', 'e8d0a5f1-3c2b-4d7e-9a61-2f5b8c4d0e02', 'fullscreen',
   'Protect the glow',
   'Daily SPF helps protect against sun damage and dark marks. Don''t skip the last step.',
   'Join the challenge', 'https://www.trackaplus.app/ads/ebun-derma/man.jpg',
   'challenge', 'e8d0a5f1-3c2b-4d7e-9a61-2f5b8c4d0e01', 0, true, null)
on conflict (id) do nothing;
