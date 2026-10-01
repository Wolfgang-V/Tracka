-- practitioner_get_client_profile() returned pregnant_or_breastfeeding
-- bundled under the 'skin_profile' scope — the most sensitive field in the
-- database, granted automatically by a toggle labeled "Skin profile" that a
-- client almost certainly isn't reading as "and my pregnancy status." The
-- consent model is scoped specifically so a client can share some things
-- and not others; this field deserved its own scope from the start.
--
-- Splitting it now, not adding a migration to backfill existing grants
-- later, because nobody has actually granted anything yet — this feature
-- has zero live care_relationships to date. Easiest moment there will ever
-- be to get this right.

-- ---------------------------------------------------------------
-- 1. New scope value, everywhere scopes are validated.
-- ---------------------------------------------------------------
alter table care_relationships drop constraint if exists care_relationships_scopes_check;
alter table care_relationships add constraint care_relationships_scopes_check
  check (scopes <@ array['skin_profile', 'routine', 'daily_logs', 'photos', 'pregnancy_status']::text[]);

alter table invitations drop constraint if exists invitations_scopes_check;
alter table invitations add constraint invitations_scopes_check
  check (scopes <@ array['skin_profile', 'routine', 'daily_logs', 'photos', 'pregnancy_status']::text[]);

create or replace function practitioner_invite_by_email(p_email text, p_scopes text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_practitioner_id uuid := auth.uid();
  v_target_user_id uuid;
  v_relationship_id uuid;
  v_token uuid;
begin
  if not exists (
    select 1 from practitioners pr
    where pr.user_id = v_practitioner_id and pr.verified_at is not null
  ) then
    raise exception 'Not authorized';
  end if;

  if p_scopes is null or not (p_scopes <@ array['skin_profile', 'routine', 'daily_logs', 'photos', 'pregnancy_status']::text[]) then
    raise exception 'Invalid scopes';
  end if;

  select id into v_target_user_id from auth.users where lower(email) = lower(p_email) limit 1;

  if v_target_user_id is not null then
    if v_target_user_id = v_practitioner_id then
      raise exception 'You can''t add yourself as a client';
    end if;

    insert into care_relationships (practitioner_id, client_id, status, scopes)
    values (v_practitioner_id, v_target_user_id, 'invited', p_scopes)
    on conflict (practitioner_id, client_id) where status in ('invited', 'active')
    do update set scopes = excluded.scopes
    returning id into v_relationship_id;

    return jsonb_build_object('kind', 'relationship', 'id', v_relationship_id);
  else
    insert into invitations (practitioner_id, invited_email, scopes)
    values (v_practitioner_id, lower(p_email), p_scopes)
    returning token into v_token;

    return jsonb_build_object('kind', 'invitation', 'token', v_token);
  end if;
end;
$$;

-- ---------------------------------------------------------------
-- 2. practitioner_get_client_profile() — skin_profile still gates the row
--    existing at all (and is still logged as a view); pregnancy status is
--    additionally gated on its own scope, independent of whether the rest
--    of the profile is shared. A client who's granted skin_profile but not
--    pregnancy_status gets everything except that one field, nulled.
-- ---------------------------------------------------------------
create or replace function practitioner_get_client_profile(p_client uuid)
returns table (
  skin_type text,
  concerns text,
  goals text,
  sensitivity text,
  gender text,
  pregnant_or_breastfeeding boolean
)
language plpgsql security definer set search_path = public
as $$
begin
  if not (select has_client_access(p_client, 'skin_profile')) then
    raise exception 'Not authorized';
  end if;

  insert into practitioner_access_log (practitioner_id, client_id, what)
  values (auth.uid(), p_client, 'view_skin_profile');

  return query
  select
    sp.skin_type, sp.concerns, sp.goals, sp.sensitivity, sp.gender,
    case when (select has_client_access(p_client, 'pregnancy_status'))
      then sp.pregnant_or_breastfeeding
      else null
    end
  from skin_profiles sp
  where sp.user_id = p_client
  order by sp.created_at desc
  limit 1;
end;
$$;
