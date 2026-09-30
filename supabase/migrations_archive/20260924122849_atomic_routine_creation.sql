-- Match the UPDATE policy: you must own the routine AND the product.
drop policy if exists "Users can create their own routine steps" on routine_steps;

create policy "Users can create their own routine steps"
  on routine_steps for insert
  with check (
    exists (select 1 from routines r
             where r.id = routine_steps.routine_id and r.user_id = auth.uid())
    and exists (select 1 from user_products up
                 where up.id = routine_steps.user_product_id and up.user_id = auth.uid())
  );

create or replace function create_routine(
  p_routine_code text,
  p_am_steps jsonb,
  p_pm_steps jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_routine_id uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  -- Without this, an empty call silently wipes the user's routine and
  -- leaves them with nothing, which looks identical to data loss.
  if coalesce(jsonb_array_length(p_am_steps), 0) = 0
     and coalesce(jsonb_array_length(p_pm_steps), 0) = 0 then
    raise exception 'A routine needs at least one step';
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
$$;;
