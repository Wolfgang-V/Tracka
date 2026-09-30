-- The deployed app deletes step completions with no date filter, which would
-- wipe a step's entire history on a single untick. Re-block deletes until the
-- fixed handler ships, then recreate this policy.
drop policy if exists "Users can delete their own completions" on routine_step_completions;;
