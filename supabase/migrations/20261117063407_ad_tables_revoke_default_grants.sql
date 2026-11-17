-- The sponsored-placements migration says the ad tables are closed "like the
-- referral platform", but it enabled RLS without revoking Supabase's default
-- grants to anon/authenticated — the referral migration did both.
--
-- Not a live hole: RLS with no policies already returns zero rows to both
-- roles (verified by role-switched probe before writing this). This is the
-- second lock, so that a permissive policy added later for one purpose
-- can't quietly open the table to every signed-in user.
--
-- Safe for the serving path: active_ads / record_ad_event / ad_console_brands
-- / ad_campaign_report are all SECURITY DEFINER and run as the owner, which
-- bypasses both grants and RLS.

revoke all on ad_brands, ad_brand_members, ad_campaigns, ad_placements, ad_events
  from anon, authenticated;
