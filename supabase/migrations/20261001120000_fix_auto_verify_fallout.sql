-- Three real consequences of removing admin approval, found by actually
-- reasoning through what changed, not just the happy path.

-- ---------------------------------------------------------------
-- 1. Reject no longer sticks. Its branch deleted the practitioners row,
--    which was fine when nothing could resurrect it — but
--    submit_practitioner_application's INSERT path verifies instantly
--    when no row exists. A rejected person just resubmits the form, hits
--    INSERT (not the UPDATE branch that protects revoked_at), and is
--    verified immediately. Reject became a button that does nothing
--    durable. Fixed the same way revoked_at already works: mark, don't
--    delete. submit_practitioner_application's ON CONFLICT branch never
--    touches verified_at (or now rejected_at) regardless, so a rejected
--    person resubmitting stays rejected without that function needing any
--    change at all.
--
--    Also: since the row is no longer deleted, admin_list_pending_practitioners()
--    needs to stop returning rejected applicants — otherwise they'd sit in
--    the pending queue forever now that there's a permanent row to find.
-- ---------------------------------------------------------------
alter table practitioners add column if not exists rejected_at timestamptz;

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
    set verified_at = now(), verified_by = auth.uid(), revoked_at = null, rejected_at = null
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

    update practitioners
    set rejected_at = now()
    where user_id = target_id and verified_at is null;

    if not found then
      raise exception 'No pending application for that user';
    end if;

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
  where pr.verified_at is null and pr.rejected_at is null
  order by pr.created_at asc;
end;
$$;

revoke all on function admin_list_pending_practitioners() from public, anon;
grant execute on function admin_list_pending_practitioners() to authenticated;

-- ---------------------------------------------------------------
-- 2. Email enumeration, reopened for everyone. practitioner_invite_by_email
--    returned a different "kind" depending on whether the email matched an
--    account — accepted earlier on the premise of "a small,
--    manually-vetted practitioner set". Auto-verify removed that premise:
--    any signed-up user can self-verify in one call and then use this
--    function to probe arbitrary addresses. Fixed by making the response
--    shape identical either way — always create (or reuse) an invitation
--    token and return only that, so the caller can never tell whether the
--    email had an account. If it did, a direct relationship is created too
--    (as before) in addition to the token.
-- ---------------------------------------------------------------
create or replace function practitioner_invite_by_email(p_email text, p_scopes text[])
returns uuid -- always an invitation token, regardless of which branch fired
language plpgsql
security definer
set search_path = public
as $$
declare
  v_practitioner_id uuid := auth.uid();
  v_target_user_id uuid;
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
    do update set scopes = excluded.scopes;
  end if;

  insert into invitations (practitioner_id, invited_email, scopes)
  values (v_practitioner_id, lower(p_email), p_scopes)
  returning token into v_token;

  return v_token;
end;
$$;

revoke all on function practitioner_invite_by_email(text, text[]) from public, anon;
grant execute on function practitioner_invite_by_email(text, text[]) to authenticated;

-- ---------------------------------------------------------------
-- 3. The directory now lists anyone who filled in the form.
--    "Anyone can browse verified practitioner profiles" filtered on
--    verified_at is not null, which used to mean "admin-approved" and now
--    means "signed up". A client browsing Find a Professional can no
--    longer tell a known aesthetician from a self-registered stranger —
--    both are presented identically. Splitting operating (can invite
--    clients immediately — self-verify, unblocked, what the growth benefit
--    actually depends on) from listed (appears in the public directory —
--    stays gated on admin review, a new column). No data is exposed
--    either way without the client's own consent — has_client_access()
--    is untouched — so the real risk this closes is someone posing as a
--    professional to persuade a user into granting access, not a data leak.
-- ---------------------------------------------------------------
alter table practitioners add column if not exists listed_at timestamptz;

drop policy if exists "Anyone can browse verified practitioner profiles" on practitioners;
create policy "Anyone can browse listed practitioner profiles"
  on practitioners for select
  using (listed_at is not null or auth.uid() = user_id);

create or replace function admin_set_practitioner_listed(target_id uuid, listed boolean)
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
  set listed_at = case when listed then now() else null end
  where user_id = target_id and verified_at is not null;

  if not found then
    raise exception 'No verified practitioner found for that user';
  end if;

  insert into admin_audit_log (actor_id, action, target_id, details)
  values (auth.uid(), case when listed then 'list_practitioner' else 'unlist_practitioner' end, target_id, '{}'::jsonb);
end;
$$;

revoke all on function admin_set_practitioner_listed(uuid, boolean) from public, anon;
grant execute on function admin_set_practitioner_listed(uuid, boolean) to authenticated;

drop function if exists admin_list_verified_practitioners();

create function admin_list_verified_practitioners()
returns table (
  user_id uuid,
  email text,
  display_name text,
  title text,
  bio text,
  specialisms text[],
  instagram text,
  whatsapp text,
  verified_at timestamptz,
  listed_at timestamptz,
  client_count bigint
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
  select
    pr.user_id, u.email::text, pr.display_name, pr.title, pr.bio,
    pr.specialisms, pr.instagram, pr.whatsapp, pr.verified_at, pr.listed_at,
    (select count(*) from care_relationships cr
      where cr.practitioner_id = pr.user_id and cr.status = 'active')
  from practitioners pr
  join auth.users u on u.id = pr.user_id
  where pr.verified_at is not null
  order by pr.verified_at desc;
end;
$$;

revoke all on function admin_list_verified_practitioners() from public, anon;
grant execute on function admin_list_verified_practitioners() to authenticated;
