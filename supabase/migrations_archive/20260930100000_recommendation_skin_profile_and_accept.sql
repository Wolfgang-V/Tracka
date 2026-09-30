-- Phase 2: a recommendation can now bundle a proposed skin profile
-- alongside products/routine, so a practitioner building a routine for a
-- client (new or existing) can propose the whole thing — skin profile,
-- products, routine, notes — and the client accepts or rejects it as one
-- unit. Still strictly proposal-based: nothing here ever writes to the
-- client's actual skin_profiles/user_products/routines directly. Only
-- accept_recommendation() does that, and only the client can call it,
-- on their own row, once.

-- ---------------------------------------------------------------
-- 1. New columns. Nullable on recommendations (a routine-only
--    recommendation for an existing client has none of these set);
--    proposes_skin_profile is the explicit flag rather than inferring
--    intent from skin_type being non-null, so a future field added here
--    can't accidentally change what "this recommendation proposes a skin
--    profile" means.
-- ---------------------------------------------------------------
alter table recommendations
  add column if not exists proposes_skin_profile boolean not null default false,
  add column if not exists gender text,
  add column if not exists skin_type text,
  add column if not exists concerns text,
  add column if not exists goals text,
  add column if not exists sensitivity text,
  add column if not exists pregnant_or_breastfeeding boolean;

alter table recommendation_items
  add column if not exists days_of_week smallint[] not null default '{0,1,2,3,4,5,6}';

-- ---------------------------------------------------------------
-- 2. Closes a pre-existing gap, found while adding the above: the
--    "Practitioners can propose recommendations" INSERT policy only ever
--    checked auth.uid() = practitioner_id — nothing stopped an unverified
--    practitioner, or one with no relationship to that client at all, from
--    inserting a recommendation straight into any client's inbox. Same
--    shape as the care_relationships/invitations gap closed in
--    20260930090000; has_client_access() already does exactly this check
--    and is reused as-is.
-- ---------------------------------------------------------------
drop policy if exists "Practitioners can propose recommendations" on recommendations;
create policy "Practitioners can propose recommendations"
  on recommendations for insert
  with check (
    auth.uid() = practitioner_id and status = 'proposed'
    and (select has_client_access(client_id, 'routine'))
  );

-- ---------------------------------------------------------------
-- 3. Extend the existing lock trigger to pin the new columns too, same
--    treatment as note — a practitioner edits by withdrawing and
--    re-proposing, never in place; a client can only ever move status to
--    accepted/declined.
-- ---------------------------------------------------------------
create or replace function lock_recommendation_fields()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() = old.client_id then
    new.practitioner_id := old.practitioner_id;
    new.client_id := old.client_id;
    new.note := old.note;
    new.created_at := old.created_at;
    new.proposes_skin_profile := old.proposes_skin_profile;
    new.gender := old.gender;
    new.skin_type := old.skin_type;
    new.concerns := old.concerns;
    new.goals := old.goals;
    new.sensitivity := old.sensitivity;
    new.pregnant_or_breastfeeding := old.pregnant_or_breastfeeding;

    if new.status not in ('accepted', 'declined') then
      raise exception 'Clients can only accept or decline a recommendation';
    end if;

  elsif auth.uid() = old.practitioner_id then
    new.practitioner_id := old.practitioner_id;
    new.client_id := old.client_id;
    new.note := old.note;
    new.created_at := old.created_at;
    new.proposes_skin_profile := old.proposes_skin_profile;
    new.gender := old.gender;
    new.skin_type := old.skin_type;
    new.concerns := old.concerns;
    new.goals := old.goals;
    new.sensitivity := old.sensitivity;
    new.pregnant_or_breastfeeding := old.pregnant_or_breastfeeding;

    if old.status <> 'proposed' or new.status <> 'superseded' then
      raise exception 'Practitioners can only withdraw a still-pending recommendation';
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------
-- 4. accept_recommendation() — the one-tap "Accept" the client calls.
--    security invoker: runs as the accepting client, through their own
--    RLS, same as create_routine() which it calls at the end — so every
--    write here is subject to the exact same policies as if the client
--    had done each step by hand from the app's existing screens.
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
      gender = excluded.gender,
      pregnant_or_breastfeeding = excluded.pregnant_or_breastfeeding,
      skin_type = excluded.skin_type,
      concerns = excluded.concerns,
      goals = excluded.goals,
      sensitivity = excluded.sensitivity;
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

  -- A pure skin-profile-only recommendation (no items) is valid — don't
  -- touch the client's routine if nothing was actually proposed for it.
  if jsonb_array_length(v_am_steps) > 0 or jsonb_array_length(v_pm_steps) > 0 then
    perform create_routine(v_routine_code, v_am_steps, v_pm_steps);
  end if;

  update recommendations
  set status = 'accepted', responded_at = now()
  where id = p_recommendation_id;
end;
$$;

revoke all on function accept_recommendation(uuid) from public, anon;
grant execute on function accept_recommendation(uuid) to authenticated;
