-- Admin -> Friend referrals: who is inviting friends, and who came in.
--
-- Friend invites (Settings -> Refer a friend) are referral_codes with an
-- owner_user_id (F-XXXXXX). The store/clinic report lumps them all under
-- one "Friend referrals" partner; this breaks them out per inviter, with
-- the friends each one brought.
--
-- Per inviter: name, username, email, code, link opens (distinct visitors),
-- new sign-ups, existing users who opened the link (not counted as
-- referrals, same as my_referral), onboarded, logged a routine, last
-- sign-up. Each friend: name, username, email, joined, new or existing,
-- onboarded, logged a routine.
--
-- Read-only; gated by can_manage_referrals() like the rest of the referral
-- admin. New function only, so it can ship before or after the app (the
-- app's tab just shows an error until this exists, so ship this FIRST).

create or replace function public.admin_friend_referrals()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_result jsonb;
begin
  if not can_manage_referrals() then
    raise exception 'Not authorized';
  end if;

  with codes as (
    select c.id as code_id, c.code, c.is_active, c.created_at as code_created_at, c.owner_user_id
    from referral_codes c
    where c.owner_user_id is not null
  ),
  opens as (
    select s.code_id, count(distinct s.visitor_id) as link_opens, max(s.scanned_at) as last_open_at
    from referral_scans s
    where s.code_id in (select code_id from codes)
    group by s.code_id
  ),
  friends as (
    select
      a.code_id,
      a.user_id,
      a.new_signup,
      a.attributed_at,
      pr.first_name,
      pr.last_name,
      pr.username,
      u.email,
      coalesce(pr.onboarding_completed, false) as onboarded,
      (exists (select 1 from routine_completions rc where rc.user_id = a.user_id)
        or exists (select 1 from routine_step_completions sc where sc.user_id = a.user_id)) as logged_routine
    from referral_attributions a
    join codes c on c.code_id = a.code_id
    left join profiles pr on pr.id = a.user_id
    left join auth.users u on u.id = a.user_id
    where a.user_id <> c.owner_user_id
  ),
  inviters as (
    select
      c.owner_user_id as user_id,
      pr.first_name,
      pr.last_name,
      pr.username,
      u.email,
      c.code,
      c.is_active,
      c.code_created_at,
      coalesce(o.link_opens, 0) as link_opens,
      o.last_open_at,
      count(f.user_id) filter (where f.new_signup) as signups,
      count(f.user_id) filter (where not f.new_signup) as existing_users,
      count(f.user_id) filter (where f.new_signup and f.onboarded) as onboarded,
      count(f.user_id) filter (where f.new_signup and f.logged_routine) as logged_routine,
      max(f.attributed_at) filter (where f.new_signup) as last_signup_at,
      coalesce(
        jsonb_agg(jsonb_build_object(
          'user_id', f.user_id,
          'first_name', f.first_name,
          'last_name', f.last_name,
          'username', f.username,
          'email', f.email,
          'joined_at', f.attributed_at,
          'new_signup', f.new_signup,
          'onboarded', f.onboarded,
          'logged_routine', f.logged_routine
        ) order by f.attributed_at desc) filter (where f.user_id is not null),
        '[]'::jsonb
      ) as friends
    from codes c
    left join profiles pr on pr.id = c.owner_user_id
    left join auth.users u on u.id = c.owner_user_id
    left join opens o on o.code_id = c.code_id
    left join friends f on f.code_id = c.code_id
    group by c.owner_user_id, pr.first_name, pr.last_name, pr.username, u.email,
             c.code, c.is_active, c.code_created_at, o.link_opens, o.last_open_at
  )
  select jsonb_build_object(
    'totals', jsonb_build_object(
      'inviters',             (select count(*) from inviters),
      'inviters_with_signups',(select count(*) from inviters where signups > 0),
      'link_opens',           (select coalesce(sum(link_opens), 0) from inviters),
      'signups',              (select coalesce(sum(signups), 0) from inviters),
      'onboarded',            (select coalesce(sum(onboarded), 0) from inviters),
      'logged_routine',       (select coalesce(sum(logged_routine), 0) from inviters)
    ),
    'inviters', coalesce((
      select jsonb_agg(to_jsonb(i) order by i.signups desc, i.link_opens desc, i.code_created_at desc)
      from inviters i
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$;

revoke all on function public.admin_friend_referrals() from public, anon;
grant execute on function public.admin_friend_referrals() to authenticated, service_role;
