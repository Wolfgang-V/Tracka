-- The "Create my routine" flow had no guard against double-tapping the
-- submit button (fixed client-side now), so a fast second tap could create
-- a second active routine before the first request's deactivation of old
-- routines had even landed. A user should only ever have one ACTIVE
-- routine per time_of_day — this keeps the newest and deactivates the
-- rest, along with their steps.
--
-- Preview what this affects before running it:
--
--   select user_id, time_of_day, count(*) as active_count,
--          array_agg(id order by created_at desc) as routine_ids
--   from routines
--   where is_active = true
--   group by user_id, time_of_day
--   having count(*) > 1;
--
-- Order matters here: routine_steps is deactivated first, while the
-- extra routines are still flagged is_active = true, so the same ranking
-- is used for both updates instead of the second one seeing an
-- already-narrowed set.

with ranked as (
  select id, row_number() over (
    partition by user_id, time_of_day order by created_at desc
  ) as rn
  from routines
  where is_active = true
)
update routine_steps set is_active = false
where routine_id in (select id from ranked where rn > 1);

with ranked as (
  select id, row_number() over (
    partition by user_id, time_of_day order by created_at desc
  ) as rn
  from routines
  where is_active = true
)
update routines set is_active = false
where id in (select id from ranked where rn > 1);
