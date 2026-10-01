-- Pulls a live-only fix back into the repo (admin_revoke_practitioner's
-- self-review guard, dropped again when 20261001090000 redefined it from a
-- stale local copy — fifth instance of this same class of regression),
-- plus a new, real danger that revocation introduced.
--
-- The reject branch of admin_review_practitioner deletes
-- care_relationships/recommendations/practitioner_access_log/invitations
-- before deleting the practitioners row. That was always safe, because
-- "verified_at is null" used to mean exactly one thing: never approved,
-- nothing real exists yet. Revocation broke that assumption — a
-- practitioner can now be verified, accumulate real client relationships
-- and recommendations, get revoked back to verified_at is null, and land
-- in admin_review_practitioner's reject branch looking identical to a
-- fresh applicant. Rejecting them would delete real accepted
-- recommendations and the audit trail clients are entitled to see.
--
-- Fixed: reject now refuses anyone with revoked_at is not null — that
-- column now does double duty, flagging a reapplication's history to the
-- admin (20261001090000) and gating reject here. The three admin actions
-- are now properly distinct: approve verifies and clears revoked_at;
-- revoke nulls verified_at and keeps every relationship/recommendation/log
-- entry, stopping access immediately; reject only ever applies to an
-- application that was never verified, and deletes everything because
-- nothing meaningful ever existed for it.
create or replace function admin_revoke_practitioner(target_id uuid)
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
    raise exception 'Cannot revoke your own verification';
  end if;

  update practitioners
  set verified_at = null, verified_by = null, revoked_at = now()
  where user_id = target_id and verified_at is not null;

  if not found then
    raise exception 'No verified practitioner found for that user';
  end if;

  insert into admin_audit_log (actor_id, action, target_id, details)
  values (auth.uid(), 'revoke_practitioner', target_id, '{}'::jsonb);
end;
$$;

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
    set verified_at = now(), verified_by = auth.uid(), revoked_at = null
    where user_id = target_id and verified_at is null;

    if not found then
      raise exception 'No pending application for that user';
    end if;

    insert into admin_audit_log (actor_id, action, target_id, details)
    values (auth.uid(), 'approve_practitioner', target_id, '{}'::jsonb);
  else
    if exists (select 1 from practitioners where user_id = target_id and revoked_at is not null) then
      raise exception 'This practitioner was previously verified — use revoke, not reject, to preserve their history';
    end if;

    if not exists (select 1 from practitioners where user_id = target_id and verified_at is null) then
      raise exception 'No pending application for that user';
    end if;

    delete from care_relationships where practitioner_id = target_id;
    delete from recommendations where practitioner_id = target_id;
    delete from practitioner_access_log where practitioner_id = target_id;
    delete from invitations where practitioner_id = target_id;

    delete from practitioners where user_id = target_id and verified_at is null;

    insert into admin_audit_log (actor_id, action, target_id, details)
    values (auth.uid(), 'reject_practitioner', target_id, '{}'::jsonb);
  end if;
end;
$$;
