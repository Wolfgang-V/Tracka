-- Nullable on purpose: null means "not asked yet", which is different
-- from a considered "no". The engine must only act on an explicit true.
alter table skin_profiles
  add column if not exists pregnant_or_breastfeeding boolean;;
