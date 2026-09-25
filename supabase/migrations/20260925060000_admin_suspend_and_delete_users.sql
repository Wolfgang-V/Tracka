-- Suspend and delete, both admin-gated the same way as admin_list_users
-- (hardcoded email check inside the function, not just client-side), both
-- refusing to target the admin's own account, and both revoked from
-- public/anon so only an authenticated session can even attempt the call
-- — the real gate is still the email check inside.
--
-- Suspend sets auth.users.banned_until directly — Auth (GoTrue) reads this
-- column on every login attempt, so this doesn't need the Admin API.
-- Unsuspend clears it back to null.
--
-- Delete removes the auth.users row directly. Whatever has
-- "references auth.users(id) on delete cascade" cleans up with it; a
-- table without that cascade will make the whole delete fail with a
-- clear FK error rather than partially deleting — nothing silent either
-- way. Not covered: files in Storage (progress photos) aren't touched by
-- a SQL delete, since Storage isn't a Postgres table — those would need
-- a follow-up if that ever matters.
create or replace function admin_suspend_user(target_id uuid, suspend boolean)
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
    raise exception 'Cannot suspend your own account';
  end if;

  update auth.users
  set banned_until = case when suspend then '2999-12-31'::timestamptz else null end
  where id = target_id;
end;
$$;

revoke all on function admin_suspend_user(uuid, boolean) from public;
grant execute on function admin_suspend_user(uuid, boolean) to authenticated;

create or replace function admin_delete_user(target_id uuid)
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
    raise exception 'Cannot delete your own account';
  end if;

  delete from auth.users where id = target_id;
end;
$$;

revoke all on function admin_delete_user(uuid) from public;
grant execute on function admin_delete_user(uuid) to authenticated;

-- admin_list_users needs to surface suspension status for the UI to show
-- it and pick the right button.
create or replace function admin_list_users()
returns table (
  id uuid,
  email text,
  username text,
  onboarding_completed boolean,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  email_confirmed_at timestamptz,
  banned_until timestamptz
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
    u.id,
    u.email::text,
    p.username,
    p.onboarding_completed,
    u.created_at,
    u.last_sign_in_at,
    u.email_confirmed_at,
    u.banned_until
  from auth.users u
  left join profiles p on p.id = u.id
  order by u.created_at desc;
end;
$$;
