-- Two new ad slots:
--   discover_card — a sponsored card in the first row of the Discover tab
--                   (until now Discover borrowed product_card ads, so its
--                   numbers were mixed in with the My products page).
--   fullscreen    — a full-screen ad shown when the app opens, at most once
--                   a day per device, always with a close button and the
--                   "Sponsored" label.
-- Nothing else changes: active_ads, record_ad_event, the report and
-- admin_upsert_ad_placement all take the slot as plain text.

alter table ad_placements drop constraint if exists ad_placements_slot_check;
alter table ad_placements add constraint ad_placements_slot_check
  check (slot in ('home_banner', 'sponsored_challenge', 'product_card', 'discover_card', 'fullscreen'));
