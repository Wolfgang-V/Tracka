-- Welcome email: new sign-ups only, no backfill.
--
-- 20261123000000 would have sent "Welcome to Tracka+!" to every confirmed
-- account that hadn't onboarded, including people who signed up in
-- September and never came back. To them it's an unexpected reactivation
-- email, and that kind of email gets marked as spam. Now only accounts
-- confirmed in the last 14 days qualify, so it's a real welcome. Older
-- inactive accounts get a separate win-back campaign (different copy,
-- unsubscribe link, small batches) from the campaign tool, not this trigger.
--
-- The 14-day window also bounds retries: a failed send stops being retried
-- once the account is two weeks old.
--
-- Ship order: this migration BEFORE send-welcome-emails is deployed. The
-- cron job is already live and calls the function every 5 minutes, so the
-- moment the function exists it sends to whatever this returns.
--
-- Correction to 20261123000000's comment on is_username_available: usernames
-- are NOT already public. profiles only lets people read their own row, and
-- challenge_ranking is service_role-only. So anon can now check whether a
-- given username exists. We accept that deliberately: it reveals only that a
-- username exists (no email, no profile data), and sign-up happens before
-- there's a session, so it can't be limited to signed-in callers.

create or replace function due_welcome_emails(p_limit int default 25)
returns table (user_id uuid, email text, first_name text, username text)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, u.email::text, p.first_name, p.username
  from auth.users u
  left join profiles p on p.id = u.id
  left join welcome_email_log l on l.user_id = u.id
  where u.email_confirmed_at is not null
    and u.email_confirmed_at > now() - interval '14 days'
    and u.email is not null
    and u.deleted_at is null
    and (u.banned_until is null or u.banned_until < now())
    and (l.user_id is null or (l.status = 'failed' and l.attempts < 3))
  order by u.email_confirmed_at
  limit greatest(1, least(p_limit, 100));
$$;
revoke all on function due_welcome_emails(int) from public, anon, authenticated;
grant execute on function due_welcome_emails(int) to service_role;
