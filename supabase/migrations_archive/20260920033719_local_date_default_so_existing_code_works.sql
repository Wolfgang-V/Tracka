alter table routine_step_completions
  alter column local_date
  set default ((now() at time zone 'Africa/Lagos')::date);;
