-- Admin "Last active" was auth.users.last_sign_in_at, which only moves on a
-- fresh password login. The installed PWA keeps people signed in for weeks
-- via silent token refresh, so the most engaged users looked dormant (e.g.
-- someone ticking their routine daily showed "last active" a fortnight ago).
--
-- last_active_at = the latest of: password sign-in, session refresh (any
-- app open), and routine tick. last_sign_in_at is still returned alongside
-- it, unchanged, for anything that wants the literal login time.
--
-- RETURNS TABLE changes need drop + create, which resets grants — so the
-- revoke/grant pair is repeated below (see migrations/README.md).

drop function if exists public.admin_list_users();

create function public.admin_list_users()
returns table (
  id uuid,
  email text,
  username text,
  onboarding_completed boolean,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  email_confirmed_at timestamptz,
  banned_until timestamptz,
  last_active_at timestamptz
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
    u.banned_until,
    -- Relies on Postgres's greatest() skipping nulls (no sessions / no
    -- ticks just drop out). Not portable: MySQL's GREATEST returns null if
    -- any argument is null. All three null = never completed a login.
    -- Two correlated subqueries per user; if this list gets slow, store
    -- last_active_at on profiles and bump it from the existing tick trigger.
    greatest(
      u.last_sign_in_at,
      (select max(s.updated_at) from auth.sessions s where s.user_id = u.id),
      (select max(c.completed_at) from routine_step_completions c where c.user_id = u.id)
    )
  from auth.users u
  left join profiles p on p.id = u.id
  order by u.created_at desc;
end;
$$;

revoke all on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated, service_role;
