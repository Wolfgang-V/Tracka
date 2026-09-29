-- Cosmetic, but a policy named "today's" that actually covers a two-day
-- window will mislead the next person reading it.
alter policy "Users can delete today's own completions"
  on routine_step_completions
  rename to "Users can delete recent own completions";
