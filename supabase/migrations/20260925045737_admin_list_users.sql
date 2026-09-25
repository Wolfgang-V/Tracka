-- auth.users.email is varchar(255). Returning it into a text column raises
-- "structure of query does not match function result type" at call time,
-- so it needs an explicit cast.
create or replace function admin_list_users()
returns table (
  id uuid,
  email text,
  username text,
  onboarding_completed boolean,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  email_confirmed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from auth.users u
    where u.id = auth.uid() and u.email = 'trackaplus@gmail.com'
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
    u.email_confirmed_at
  from auth.users u
  left join profiles p on p.id = u.id
  order by u.created_at desc;
end;
$$;

revoke all on function admin_list_users() from public;
grant execute on function admin_list_users() to authenticated;;
