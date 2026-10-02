alter table routine_completions
  add column if not exists time_of_day text not null default 'PM';

alter table routine_completions
  drop constraint if exists routine_completions_user_id_completed_date_key;

alter table routine_completions
  add constraint routine_completions_time_of_day_check
    check (time_of_day in ('AM', 'PM'));

alter table routine_completions
  add constraint routine_completions_user_date_time_key
    unique (user_id, completed_date, time_of_day);