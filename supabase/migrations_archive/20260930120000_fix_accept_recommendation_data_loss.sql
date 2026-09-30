-- Three real data-loss bugs the reviewer found in accept_recommendation
-- before any client had actually tapped Accept. Fixing all three here.

-- ---------------------------------------------------------------
-- 0. Pulls a live-only fix back into the repo: the reviewer added a bounds
--    check on recommendation_items.days_of_week (matching the one already
--    on routine_steps) when applying 20260930100000, so a recommendation
--    can't propose a days_of_week value routine_steps would later reject.
--    That check was never written to a migration file — recorded here so
--    the repo matches what's actually live.
-- ---------------------------------------------------------------
alter table recommendation_items
  add constraint recommendation_items_days_of_week_check
  check (
    array_length(days_of_week, 1) between 1 and 7
    and days_of_week <@ array[0,1,2,3,4,5,6]::smallint[]
  );

-- ---------------------------------------------------------------
-- 1. Duplicate products: accepting a recommendation for a product the
--    client already actively has gave them a second row for the same
--    product, showing up twice in their routine. Partial unique index (only
--    active rows — a client re-adding something they'd previously removed
--    is still fine) plus an upsert instead of a plain insert.
-- ---------------------------------------------------------------
create unique index if not exists user_products_active_unique
  on user_products (user_id, product_id)
  where is_active = true;

-- ---------------------------------------------------------------
-- 2. accept_recommendation rewritten:
--    - A recommendation that only touches one slot (e.g. PM-only) used to
--      wipe the client's other, untouched slot — create_routine always
--      deactivates every active routine before inserting, and a slot with
--      no proposed items just stayed empty. Now: if the recommendation has
--      no items for a slot, that slot's current active routine_steps are
--      read back and re-supplied to create_routine, so it's recreated
--      as-is instead of disappearing. A slot the recommendation DOES touch
--      is still treated as the complete new set for that slot, same as the
--      client's own routine builder.
--    - Skin profile upsert used to overwrite every column from the
--      recommendation, including ones the practitioner left blank — a
--      recommendation that only set skin_type erased the client's own
--      concerns/goals/etc. Now coalesces each column against the existing
--      value, so an unset field is left alone rather than cleared.
--    - user_products insert is now an upsert against the new unique index,
--      so a product the client already actively has is reused instead of
--      duplicated.
-- ---------------------------------------------------------------
create or replace function accept_recommendation(p_recommendation_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_rec recommendations;
  v_item record;
  v_user_product_id uuid;
  v_am_steps jsonb := '[]'::jsonb;
  v_pm_steps jsonb := '[]'::jsonb;
  v_order_am int := 0;
  v_order_pm int := 0;
  v_routine_code text := 'TRK-' || right(extract(epoch from clock_timestamp())::bigint::text, 6);
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_rec from recommendations where id = p_recommendation_id for update;

  if not found then
    raise exception 'Recommendation not found';
  end if;

  if v_rec.client_id <> v_user_id then
    raise exception 'Not authorized';
  end if;

  if v_rec.status <> 'proposed' then
    raise exception 'This recommendation is no longer pending';
  end if;

  if v_rec.proposes_skin_profile then
    insert into skin_profiles (user_id, gender, pregnant_or_breastfeeding, skin_type, concerns, goals, sensitivity)
    values (v_user_id, v_rec.gender, v_rec.pregnant_or_breastfeeding, v_rec.skin_type, v_rec.concerns, v_rec.goals, v_rec.sensitivity)
    on conflict (user_id) do update set
      gender = coalesce(excluded.gender, skin_profiles.gender),
      pregnant_or_breastfeeding = coalesce(excluded.pregnant_or_breastfeeding, skin_profiles.pregnant_or_breastfeeding),
      skin_type = coalesce(excluded.skin_type, skin_profiles.skin_type),
      concerns = coalesce(excluded.concerns, skin_profiles.concerns),
      goals = coalesce(excluded.goals, skin_profiles.goals),
      sensitivity = coalesce(excluded.sensitivity, skin_profiles.sensitivity);
  end if;

  for v_item in
    select ri.*, p.name as product_name
    from recommendation_items ri
    join products p on p.id = ri.product_id
    where ri.recommendation_id = p_recommendation_id
    order by ri.sort_order
  loop
    insert into user_products (user_id, product_id, is_active)
    values (v_user_id, v_item.product_id, true)
    on conflict (user_id, product_id) where is_active = true
    do update set is_active = true
    returning id into v_user_product_id;

    if v_item.slot = 'AM' then
      v_order_am := v_order_am + 1;
      v_am_steps := v_am_steps || jsonb_build_object(
        'user_product_id', v_user_product_id,
        'step_order', v_order_am,
        'step_name', v_item.product_name,
        'frequency', v_item.frequency,
        'days_of_week', v_item.days_of_week
      );
    else
      v_order_pm := v_order_pm + 1;
      v_pm_steps := v_pm_steps || jsonb_build_object(
        'user_product_id', v_user_product_id,
        'step_order', v_order_pm,
        'step_name', v_item.product_name,
        'frequency', v_item.frequency,
        'days_of_week', v_item.days_of_week
      );
    end if;
  end loop;

  -- The recommendation didn't touch this slot — preserve whatever the
  -- client currently has there instead of letting create_routine's
  -- deactivate-then-insert wipe it.
  if jsonb_array_length(v_am_steps) = 0 then
    select coalesce(jsonb_agg(jsonb_build_object(
      'user_product_id', rs.user_product_id,
      'step_order', rs.step_order,
      'step_name', rs.step_name,
      'frequency', rs.frequency,
      'days_of_week', rs.days_of_week
    ) order by rs.step_order), '[]'::jsonb)
    into v_am_steps
    from routine_steps rs
    join routines r on r.id = rs.routine_id
    where r.user_id = v_user_id and r.time_of_day = 'AM' and r.is_active = true and rs.is_active = true;
  end if;

  if jsonb_array_length(v_pm_steps) = 0 then
    select coalesce(jsonb_agg(jsonb_build_object(
      'user_product_id', rs.user_product_id,
      'step_order', rs.step_order,
      'step_name', rs.step_name,
      'frequency', rs.frequency,
      'days_of_week', rs.days_of_week
    ) order by rs.step_order), '[]'::jsonb)
    into v_pm_steps
    from routine_steps rs
    join routines r on r.id = rs.routine_id
    where r.user_id = v_user_id and r.time_of_day = 'PM' and r.is_active = true and rs.is_active = true;
  end if;

  -- A pure skin-profile-only recommendation, for a client with no routine
  -- at all yet, legitimately has nothing to build — don't call
  -- create_routine in that case, same as before.
  if jsonb_array_length(v_am_steps) > 0 or jsonb_array_length(v_pm_steps) > 0 then
    perform create_routine(v_routine_code, v_am_steps, v_pm_steps);
  end if;

  update recommendations
  set status = 'accepted', responded_at = now()
  where id = p_recommendation_id;
end;
$$;
