-- 1. Missing policies that make features silently fail
create policy "Users can delete their own completions"
  on routine_step_completions for delete
  using (auth.uid() = user_id);

create policy "Users can remove their own products"
  on user_products for delete
  using (auth.uid() = user_id);

create policy "Users can update their own profile"
  on profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- 2. Give step completions a real local day, so grouping and streaks
--    stop depending on UTC conversion at read time
alter table routine_step_completions
  add column if not exists local_date date;

update routine_step_completions
  set local_date = (completed_at at time zone 'Africa/Lagos')::date
  where local_date is null;

alter table routine_step_completions
  alter column local_date set not null;;
