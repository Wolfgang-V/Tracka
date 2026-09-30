-- The "Add Client" entry point — a practitioner types an email, and it
-- works the same way whether or not that person already has a Tracka+
-- account, matching the PDF wireframe's single email field (no branch the
-- practitioner has to think about). Security definer because it needs to
-- look up auth.users by email, same precedent as the admin_* functions;
-- explicit verified_at check inside since SECURITY DEFINER bypasses the
-- care_relationships/invitations RLS gates added in 20260930090000.
create or replace function practitioner_invite_by_email(p_email text, p_scopes text[])
returns jsonb -- {"kind": "relationship", "id": uuid} or {"kind": "invitation", "token": uuid}
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

  if p_scopes is null or not (p_scopes <@ array['skin_profile', 'routine', 'daily_logs', 'photos']::text[]) then
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

revoke all on function practitioner_invite_by_email(text, text[]) from public, anon;
grant execute on function practitioner_invite_by_email(text, text[]) to authenticated;
