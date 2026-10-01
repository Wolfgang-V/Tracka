-- Two gaps the reviewer found after applying the verified-practitioner
-- management migration, both real:
--
-- 1. admin_revoke_practitioner() nulls verified_at to cut off access
--    immediately (correct — has_client_access() needs exactly that one
--    column). But admin_list_pending_practitioners() selects where
--    verified_at is null, so a revoked practitioner silently reappears in
--    Approvals, indistinguishable from someone who just applied for the
--    first time. An admin could revoke someone for cause and re-approve
--    the same person later without knowing it. Fixed with a new
--    revoked_at column — set on revoke, cleared on approval, surfaced in
--    the pending list so a reapplication is still reviewable, just with
--    its history visible rather than hidden.
--
-- 2. A revoked practitioner's clients still see status = 'active' on their
--    side. No data actually flows — has_client_access() and
--    practitioner_list_clients() both already gate on verified_at — but
--    the client's own Care Team screen has no way to tell the difference
--    between a real active relationship and a dead one pointing at
--    someone who's lost verification. Fixed client-side by reading
--    practitioners.verified_at alongside the relationship and showing it
--    as inactive rather than silently wrong.

alter table practitioners add column if not exists revoked_at timestamptz;

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

drop function if exists admin_list_pending_practitioners();

create function admin_list_pending_practitioners()
returns table (
  user_id uuid,
  email text,
  display_name text,
  title text,
  bio text,
  specialisms text[],
  instagram text,
  whatsapp text,
  created_at timestamptz,
  revoked_at timestamptz
)
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

  return query
  select pr.user_id, u.email::text, pr.display_name, pr.title, pr.bio, pr.specialisms, pr.instagram, pr.whatsapp, pr.created_at, pr.revoked_at
  from practitioners pr
  join auth.users u on u.id = pr.user_id
  where pr.verified_at is null
  order by pr.created_at asc;
end;
$$;

revoke all on function admin_list_pending_practitioners() from public, anon;
grant execute on function admin_list_pending_practitioners() to authenticated;
