-- profile_on_signup_and_single_active_routine (19 Sep) already archived
-- every duplicate active routine — 14 active routines / 7 users, one per
-- slot, confirmed clean. This is the durable half: the constraint that
-- keeps it that way, instead of relying on every code path to remember
-- to deactivate old routines before inserting a new one. Same shape as
-- the skin_profiles unique(user_id) fix.
--
-- Checked before writing this: the only insert into routines anywhere in
-- src/App.jsx (the routinePlanner "Create my routine" handler) already
-- deactivates all of the user's routines first, in the same handler, so
-- this constraint can never be violated by it. The amRoutine/pmRoutine/
-- routineBuilder screens that used to insert without deactivating don't
-- exist in the app anymore — no setScreen() reaches them, no render
-- branch defines them.
create unique index routines_one_active_per_slot
  on routines (user_id, time_of_day)
  where is_active;
