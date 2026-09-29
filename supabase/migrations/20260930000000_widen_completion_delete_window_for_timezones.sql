-- Unticking a step sends the client's own local_date (from localStorage's
-- 4am-cutoff localDateString()), but this policy independently recomputed
-- "today" as a plain midnight-cutoff Africa/Lagos date with no grace. Any
-- time between local midnight and 4am, those two disagree — the client
-- still calls it "yesterday", the policy already calls it "today" — so
-- the DELETE matched zero rows and silently no-opped. The UI still showed
-- the step as unticked (optimistic local state), but the row never left
-- the table, so it kept counting toward that day's streak and kept
-- showing up in the Progress calendar's day detail as done.
--
-- Same fix shape as the opened_date check from 2026-09-26: a grace window
-- instead of an exact match, wide enough to cover the cutoff gap without
-- reopening the original problem (erasing arbitrary past history).
drop policy if exists "Users can delete today's own completions" on routine_step_completions;

create policy "Users can delete today's own completions"
  on routine_step_completions for delete
  using (
    auth.uid() = user_id
    and local_date >= ((now() at time zone 'Africa/Lagos')::date - 1)
    and local_date <= (now() at time zone 'Africa/Lagos')::date
  );
