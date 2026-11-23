-- One tap from "you can't join, no sunscreen" to "joined".
--
-- Sunscreen challenges (rule am_sunscreen) need a sunscreen step in an
-- active AM routine; join_challenge refuses with NO_SUNSCREEN_STEP otherwise.
-- On 2026-11-23 that was 158 of 217 accounts (141 with no AM routine at all,
-- 17 with one but no sunscreen), so most people tapping the Ebun Derma
-- pop-up would have hit a dead end. The app now offers: "Use <a sunscreen
-- you own>" / "Add Ebun Derma SPF 50" / "Add my own sunscreen", then calls
-- this, then joins.
--
-- add_sunscreen_to_morning(user_product_id): puts the caller's own
-- sunscreen product at the end of their active AM routine, creating an AM
-- routine if they have none (other routines are left exactly as they are,
-- unlike create_routine, which replaces everything). Does nothing if that
-- product is already an active AM step. Returns the AM routine id.
--
-- Ship order: this migration FIRST, then the app.

create or replace function add_sunscreen_to_morning(p_user_product_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_routine uuid;
  v_code text;
begin
  if v_user is null then
    raise exception 'Not signed in';
  end if;

  -- Must be the caller's own product, and a sunscreen (the same test the
  -- challenge uses, so adding it is guaranteed to make the join succeed).
  if not exists (
    select 1
    from user_products up
    join products p on p.id = up.product_id
    where up.id = p_user_product_id
      and up.user_id = v_user
      and lower(p.category) = 'sunscreen'
  ) then
    raise exception 'NOT_A_SUNSCREEN';
  end if;

  select r.id into v_routine
  from routines r
  where r.user_id = v_user and r.is_active and r.time_of_day = 'AM'
  order by r.created_at desc
  limit 1;

  if v_routine is null then
    -- Same shape create_routine makes; share the PM routine's code if any.
    select r.routine_code into v_code
    from routines r
    where r.user_id = v_user and r.is_active
    order by r.created_at desc
    limit 1;

    insert into routines (user_id, name, time_of_day, routine_code, is_active)
    values (v_user, 'AM Routine', 'AM', v_code, true)
    returning id into v_routine;
  end if;

  if not exists (
    select 1 from routine_steps
    where routine_id = v_routine and user_product_id = p_user_product_id and is_active
  ) then
    insert into routine_steps (routine_id, user_product_id, step_order, step_name, frequency, days_of_week, is_active)
    values (
      v_routine,
      p_user_product_id,
      coalesce((select max(step_order) from routine_steps where routine_id = v_routine and is_active), 0) + 1,
      'Sunscreen',
      'daily',
      '{0,1,2,3,4,5,6}',
      true
    );
  end if;

  return v_routine;
end;
$$;

revoke all on function add_sunscreen_to_morning(uuid) from public, anon;
grant execute on function add_sunscreen_to_morning(uuid) to authenticated;
