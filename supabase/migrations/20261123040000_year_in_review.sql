-- Tracka+ Wrapped: "Your <year> in skincare", the end-of-year story.
--
-- my_year_in_review(year) returns everything the story needs for the
-- CALLER only, in one call:
--   days_showed_up   distinct days with at least one step ticked
--   am / pm / both   full AM routines, PM routines, days with both
--   steps_ticked     every step ticked
--   best_streak      longest run of consecutive days with a full routine done
--   busiest_month    month (1-12) with the most full routines
--   top_products     the 3 products ticked most (brand, name, category, image)
--   products_added, empties (finished_at), photos, skin_logs
--   challenges       each one joined: title, days, target, status
--   percentile       % of members (with any routine done this year) who
--                    showed up on fewer days than you. Aggregate only, nothing
--                    about anyone else is returned. Null below 10 members.
--   first_name, joined_on
--
-- Read-only, security definer only so the percentile can count other people;
-- every other figure is filtered to auth.uid().
--
-- Ship order: this migration FIRST, then the app (Wrapped calls it).

create or replace function my_year_in_review(p_year int default extract(year from now())::int)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_from date := make_date(p_year, 1, 1);
  v_to date := make_date(p_year, 12, 31);
  v_days int;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select count(distinct local_date) into v_days
  from routine_step_completions
  where user_id = v_uid and local_date between v_from and v_to;

  with rc as (
    select completed_date, time_of_day
    from routine_completions
    where user_id = v_uid and completed_date between v_from and v_to
  ),
  done_days as (
    select distinct completed_date d from rc
  ),
  runs as (
    select d, d - (row_number() over (order by d))::int as grp from done_days
  ),
  per_day_everyone as (
    select user_id, count(distinct local_date) as days
    from routine_step_completions
    where local_date between v_from and v_to
    group by user_id
  ),
  ticks as (
    select up.product_id, count(*) as n
    from routine_step_completions c
    join routine_steps s on s.id = c.routine_step_id
    join user_products up on up.id = s.user_product_id
    where c.user_id = v_uid and c.local_date between v_from and v_to
    group by up.product_id
  )
  select jsonb_build_object(
    'year', p_year,
    'first_name', (select nullif(trim(coalesce(p.first_name, p.username, '')), '') from profiles p where p.id = v_uid),
    'joined_on', (select u.created_at::date from auth.users u where u.id = v_uid),
    'days_showed_up', v_days,
    'am', (select count(*) from rc where time_of_day = 'AM'),
    'pm', (select count(*) from rc where time_of_day = 'PM'),
    'both', (select count(*) from (select completed_date from rc group by completed_date having count(distinct time_of_day) = 2) b),
    'steps_ticked', (select count(*) from routine_step_completions
                     where user_id = v_uid and local_date between v_from and v_to),
    'best_streak', coalesce((select max(cnt) from (select count(*) cnt from runs group by grp) r), 0),
    'busiest_month', (select extract(month from completed_date)::int from rc
                      group by 1 order by count(*) desc, 1 limit 1),
    'top_products', coalesce((
      select jsonb_agg(jsonb_build_object('brand', pr.brand, 'name', pr.name, 'category', pr.category,
                                          'image_url', pr.image_url, 'times', t.n) order by t.n desc)
      from (select * from ticks order by n desc limit 3) t
      join products pr on pr.id = t.product_id), '[]'::jsonb),
    'products_added', (select count(*) from user_products
                       where user_id = v_uid and added_at::date between v_from and v_to),
    'empties', (select count(*) from user_products
                where user_id = v_uid and finished_at::date between v_from and v_to),
    'photos', (select count(*) from progress_photos
               where user_id = v_uid and local_date between v_from and v_to),
    'skin_logs', (select count(*) from skin_logs
                  where user_id = v_uid and local_date between v_from and v_to),
    'challenges', coalesce((
      select jsonb_agg(jsonb_build_object('title', c.title, 'days', cp.days_completed,
                                          'target', coalesce(c.target_days, c.duration_days),
                                          'status', cp.status) order by cp.joined_at)
      from challenge_participants cp join challenges c on c.id = cp.challenge_id
      where cp.user_id = v_uid and cp.joined_at::date between v_from and v_to), '[]'::jsonb),
    'percentile', case
      when (select count(*) from per_day_everyone) < 10 or v_days = 0 then null
      else (select round(100.0 * count(*) filter (where days < v_days) / count(*))::int from per_day_everyone)
    end
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function my_year_in_review(int) from public, anon;
grant execute on function my_year_in_review(int) to authenticated;
