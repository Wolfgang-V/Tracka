-- Keep the earliest completion in each (user, step, day) group
delete from routine_step_completions rsc
using (
  select id,
         row_number() over (
           partition by user_id, routine_step_id, local_date
           order by completed_at asc, id asc
         ) as rn
  from routine_step_completions
) ranked
where rsc.id = ranked.id
  and ranked.rn > 1;

alter table routine_step_completions
  add constraint routine_step_completions_user_step_day_key
  unique (user_id, routine_step_id, local_date);

create index if not exists routine_step_completions_user_day_idx
  on routine_step_completions (user_id, local_date);;
