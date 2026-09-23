-- Two optional skin-profile fields that actually change engine output,
-- unlike gender (which the app collects but never acts on). Both are
-- nullable: null means "not answered," not "no."
--
-- pregnant_or_breastfeeding: the one field with real clinical stakes.
-- Retinoids are advised against during pregnancy/breastfeeding, so when
-- this is true, planNight holds those steps back instead of scheduling
-- them — see detectActive/planNight for the engine-side change.
alter table skin_profiles
  add column if not exists pregnant_or_breastfeeding boolean;
