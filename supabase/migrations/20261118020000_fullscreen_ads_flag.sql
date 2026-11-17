-- On/off switch for full-screen ads, flipped from the admin panel instead
-- of a code change. Starts OFF: with so few active users, an ad in front
-- of someone's routine costs more than it earns (agreed 2026-11-17).
-- Reuses the existing feature_flags table: everyone can read it, and only
-- admin_set_feature_flag (admin-only, audit-logged) can change it.

insert into feature_flags (key, enabled)
values ('fullscreen_ads', false)
on conflict (key) do nothing;
