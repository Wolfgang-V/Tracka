-- Closes a gap the reviewer found: "nothing unlocks until verified_at is
-- non-null" was the stated design for this feature from the start, but the
-- care_relationships/invitations INSERT policies only ever checked
-- auth.uid() = practitioner_id — an unverified (or since-rejected) self-
-- registration could still send invites, have them accepted, and see the
-- usernames of everyone who accepted. No health data leaks (has_client_access
-- still gates that correctly), but the client list itself shouldn't exist
-- for someone who was never approved.

-- ---------------------------------------------------------------
-- 1. Gate invite creation on verification, both paths.
-- ---------------------------------------------------------------
drop policy if exists "Practitioners can invite existing clients" on care_relationships;
create policy "Practitioners can invite existing clients"
  on care_relationships for insert
  with check (
    auth.uid() = practitioner_id and status = 'invited'
    and exists (
      select 1 from practitioners pr
      where pr.user_id = auth.uid() and pr.verified_at is not null
    )
  );

drop policy if exists "Practitioners can create invitations" on invitations;
create policy "Practitioners can create invitations"
  on invitations for insert
  with check (
    auth.uid() = practitioner_id
    and exists (
      select 1 from practitioners pr
      where pr.user_id = auth.uid() and pr.verified_at is not null
    )
  );

-- ---------------------------------------------------------------
-- 2. practitioner_list_clients() — defense in depth. The insert gate above
--    stops new relationships from being created, but this keeps the list
--    correct for anyone who already had relationships before this migration,
--    or if verified_at is ever cleared on an existing practitioner later.
-- ---------------------------------------------------------------
create or replace function practitioner_list_clients()
returns table (
  relationship_id uuid,
  client_id uuid,
  username text,
  status text,
  scopes text[],
  accepted_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (
    select 1 from practitioners pr
    where pr.user_id = auth.uid() and pr.verified_at is not null
  ) then
    return;
  end if;

  return query
  select cr.id, cr.client_id, p.username, cr.status, cr.scopes, cr.accepted_at
  from care_relationships cr
  join profiles p on p.id = cr.client_id
  where cr.practitioner_id = auth.uid()
    and cr.status in ('invited', 'active')
  order by cr.accepted_at desc nulls last, cr.invited_at desc;
end;
$$;

-- ---------------------------------------------------------------
-- 3. Rejection cleanup — reject deletes the practitioners row outright, and
--    used to leave any care_relationships/invitations rows behind, pointing
--    at someone no longer a practitioner. Delete them outright in the same
--    transaction as the reject, same reasoning as the practitioners row
--    itself: nothing meaningful ever existed for an unverified applicant,
--    so there's no "this ended" state worth keeping a record of (contrast
--    with practitioner_access_log, which is left alone deliberately — it
--    references auth.users, not practitioners, and a client should still
--    be able to see who looked at their profile even after that person is
--    no longer a practitioner).
-- ---------------------------------------------------------------
create or replace function admin_review_practitioner(target_id uuid, approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from auth.users u
    where u.id = auth.uid() and u.email = 'trackaplusapp@gmail.com'
  ) then
    raise exception 'Not authorized';
  end if;

  if target_id = auth.uid() then
    raise exception 'Cannot review your own application';
  end if;

  if approve then
    update practitioners
    set verified_at = now(), verified_by = auth.uid()
    where user_id = target_id and verified_at is null;

    if not found then
      raise exception 'No pending application for that user';
    end if;

    insert into admin_audit_log (actor_id, action, target_id, details)
    values (auth.uid(), 'approve_practitioner', target_id, '{}'::jsonb);
  else
    delete from practitioners where user_id = target_id and verified_at is null;

    if not found then
      raise exception 'No pending application for that user';
    end if;

    delete from care_relationships where practitioner_id = target_id;
    delete from invitations where practitioner_id = target_id;

    insert into admin_audit_log (actor_id, action, target_id, details)
    values (auth.uid(), 'reject_practitioner', target_id, '{}'::jsonb);
  end if;
end;
$$;
