-- routinePlanner currently deactivates old routines, then inserts new
-- ones, as separate requests from the client. If the deactivate lands and
-- the insert then fails (dropped connection, timeout — the kind of thing
-- that happens on a flaky mobile network), the user is left with zero
-- active routines: Today shows "You haven't set up a routine yet" even
-- though their products are all still there.
--
-- This moves the whole operation into one function, so it's one
-- transaction: either the swap fully happens or nothing changes at all.
-- security invoker (the default) — it runs as the calling user, so the
-- existing RLS policies on routines/routine_steps still apply exactly as
-- they do today; this isn't a privilege escalation, just fewer round trips.
--
-- Writes both frequency and days_of_week: frequency is still the cadence
-- ("every 3 nights", resolved against history in planNight), days_of_week
-- is a constraint on top of it ("but never on a Sunday"), not a
-- replacement — see the note at the top of src/lib/core/planNight.js for
-- why collapsing these into days_of_week alone breaks skip-resilience.
-- This function has never been created before (confirmed nothing named
-- create_routine exists yet), so this is a first create, not a replace.
--
-- set search_path = public: without it, table names resolve against
-- whatever search_path the caller happens to have, which Supabase's own
-- linter flags as a hijacking risk.
create or replace function create_routine(
  p_routine_code text,
  p_am_steps jsonb,
  p_pm_steps jsonb
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_routine_id uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  -- Both empty would deactivate every existing routine and create nothing
  -- — indistinguishable from data loss from the user's side, and silent.
  if jsonb_array_length(p_am_steps) = 0 and jsonb_array_length(p_pm_steps) = 0 then
    raise exception 'At least one of p_am_steps or p_pm_steps must be non-empty';
  end if;

  update routine_steps
  set is_active = false
  where routine_id in (
    select id from routines where user_id = v_user_id and is_active = true
  );

  update routines
  set is_active = false
  where user_id = v_user_id and is_active = true;

  if jsonb_array_length(p_am_steps) > 0 then
    insert into routines (user_id, name, time_of_day, routine_code, is_active)
    values (v_user_id, 'AM Routine', 'AM', p_routine_code, true)
    returning id into v_routine_id;

    insert into routine_steps (routine_id, user_product_id, step_order, step_name, frequency, days_of_week, is_active)
    select
      v_routine_id,
      (elem->>'user_product_id')::uuid,
      (elem->>'step_order')::int,
      elem->>'step_name',
      coalesce(elem->>'frequency', 'daily'),
      coalesce(
        (select array_agg(x::smallint) from jsonb_array_elements_text(elem->'days_of_week') as x),
        '{0,1,2,3,4,5,6}'
      ),
      true
    from jsonb_array_elements(p_am_steps) as elem;
  end if;

  if jsonb_array_length(p_pm_steps) > 0 then
    insert into routines (user_id, name, time_of_day, routine_code, is_active)
    values (v_user_id, 'PM Routine', 'PM', p_routine_code, true)
    returning id into v_routine_id;

    insert into routine_steps (routine_id, user_product_id, step_order, step_name, frequency, days_of_week, is_active)
    select
      v_routine_id,
      (elem->>'user_product_id')::uuid,
      (elem->>'step_order')::int,
      elem->>'step_name',
      coalesce(elem->>'frequency', 'daily'),
      coalesce(
        (select array_agg(x::smallint) from jsonb_array_elements_text(elem->'days_of_week') as x),
        '{0,1,2,3,4,5,6}'
      ),
      true
    from jsonb_array_elements(p_pm_steps) as elem;
  end if;
end;
$$;
