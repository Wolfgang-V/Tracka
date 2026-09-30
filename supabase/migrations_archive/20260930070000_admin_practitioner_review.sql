-- Admin approval for aesthetician applications — same shape as the
-- existing admin_suspend_user/admin_delete_user: caller identity checked
-- inside the function (the client-side ADMIN_EMAIL check is UX only),
-- every action logged to admin_audit_log.
create or replace function admin_list_pending_practitioners()
returns table (
  user_id uuid,
  email text,
  display_name text,
  bio text,
  specialisms text[],
  instagram text,
  whatsapp text,
  created_at timestamptz
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
  select pr.user_id, u.email::text, pr.display_name, pr.bio, pr.specialisms, pr.instagram, pr.whatsapp, pr.created_at
  from practitioners pr
  join auth.users u on u.id = pr.user_id
  where pr.verified_at is null
  order by pr.created_at asc;
end;
$$;

revoke all on function admin_list_pending_practitioners() from public, anon;
grant execute on function admin_list_pending_practitioners() to authenticated;

-- Approve sets verified_at/verified_by (has_client_access starts honouring
-- their relationships immediately). Reject deletes the row outright, same
-- pattern as cancelling an invitation — nothing meaningful ever existed
-- for an unverified applicant (no relationships, no access, no history),
-- so there's no state worth keeping around; resubmitting is a fresh apply.
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

    insert into admin_audit_log (actor_id, action, target_id, details)
    values (auth.uid(), 'reject_practitioner', target_id, '{}'::jsonb);
  end if;
end;
$$;

revoke all on function admin_review_practitioner(uuid, boolean) from public, anon;
grant execute on function admin_review_practitioner(uuid, boolean) to authenticated;
