-- Partial unique index: archived routines are unconstrained, so history
-- is untouched, but a user can only ever have one live AM and one live PM.
create unique index routines_one_active_per_slot
  on routines (user_id, time_of_day)
  where is_active;;
