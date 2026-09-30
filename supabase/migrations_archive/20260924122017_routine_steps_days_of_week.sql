alter table routine_steps
  add column if not exists days_of_week smallint[] not null default '{0,1,2,3,4,5,6}';

-- Whatever 0 means, it has to be a weekday, and the set can't be empty
-- (an empty array would mean "never", which no UI can express).
alter table routine_steps
  add constraint routine_steps_days_of_week_check
  check (
    array_length(days_of_week, 1) between 1 and 7
    and days_of_week <@ array[0,1,2,3,4,5,6]::smallint[]
  );;
