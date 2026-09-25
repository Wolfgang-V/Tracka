-- Unticking only ever makes sense for today. Enforcing that in the policy
-- means a client bug can never erase past days, with or without a date filter.
create policy "Users can delete today's own completions"
  on routine_step_completions for delete
  using (
    auth.uid() = user_id
    and local_date = (now() at time zone 'Africa/Lagos')::date
  );;
