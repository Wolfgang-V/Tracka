-- Destructive admin actions with no record of who did them is a bad place
-- to be even with one admin. RLS on with no policies: only definer
-- functions and the service role can touch it.
create table if not exists admin_audit_log (
  id         uuid primary key default gen_random_uuid(),
  actor_id   uuid not null,
  action     text not null,
  target_id  uuid,
  details    jsonb,
  created_at timestamptz not null default now()
);

alter table admin_audit_log enable row level security;

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

  if not found then
    raise exception 'No such user';
  end if;

  insert into admin_audit_log (actor_id, action, target_id, details)
  values (auth.uid(),
          case when suspend then 'suspend' else 'unsuspend' end,
          target_id,
          jsonb_build_object('suspend', suspend));
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
declare
  v_email text;
  v_photos int;
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

  select u.email::text into v_email from auth.users u where u.id = target_id;

  if v_email is null then
    raise exception 'No such user';
  end if;

  -- Deleting the row does NOT remove the stored file. Refuse rather than
  -- silently orphan someone's face photos in the bucket forever; the caller
  -- must clear them through the storage API first.
  select count(*) into v_photos from progress_photos where user_id = target_id;

  if v_photos > 0 then
    raise exception 'User has % progress photo(s). Delete the files from storage first.', v_photos;
  end if;

  insert into admin_audit_log (actor_id, action, target_id, details)
  values (auth.uid(), 'delete', target_id, jsonb_build_object('email', v_email));

  delete from auth.users where id = target_id;
end;
$$;

revoke all on function admin_delete_user(uuid) from public;
grant execute on function admin_delete_user(uuid) to authenticated;

-- Return type gained a column, and create-or-replace can't change a
-- return type. It has to be dropped first.
drop function if exists admin_list_users();

create function admin_list_users()
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

revoke all on function admin_list_users() from public;
grant execute on function admin_list_users() to authenticated;;
