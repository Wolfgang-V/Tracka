-- Replaces the frequency picker ("Every 3 days", "Twice a week") in Build
-- my routine with specific weekday selection. 0=Sunday..6=Saturday,
-- matching JS Date.getDay() so the engine can compare directly without a
-- lookup table. Defaults to every day, matching frequency's old 'daily'
-- default — existing rows and any code path that doesn't set this yet
-- keep behaving as "every day" rather than silently becoming "never".
--
-- frequency is left in place, unused by the app going forward. Not
-- dropping it yet — same caution as skin_profiles.gender: cheap to remove
-- once nothing reads it, expensive to reconstruct if that turns out to be
-- wrong.
alter table routine_steps
  add column if not exists days_of_week smallint[] not null default '{0,1,2,3,4,5,6}';
