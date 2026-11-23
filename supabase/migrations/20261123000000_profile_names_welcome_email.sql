-- Names, promo-email consent, and the welcome email.
--
-- 1. profiles gains first_name, last_name and marketing_opt_in (+ when it
--    was last changed). Sign-up sends them as auth metadata; the
--    handle_new_user trigger copies them in. People edit them in
--    Settings → Your details.
-- 2. welcome_email_log + due_welcome_emails(): the send-welcome-emails edge
--    function (cron, every 5 min) sends the welcome email once to every
--    confirmed account that isn't in the log yet, i.e. new users right after
--    they confirm, plus everyone who hasn't onboarded yet (backfill).
--    People who had already onboarded when this ran are logged as 'skipped'
--    so they don't get it.
--
-- Ship order: this migration FIRST, then the app and the edge function.
-- The new sign-up form and Settings → Your details write the new columns,
-- which don't exist before this. The edge function calls
-- due_welcome_emails(). Old app versions keep working with this migration
-- (they just don't send the new fields).

-- 1. Columns -------------------------------------------------------------
alter table profiles
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists marketing_opt_in boolean not null default false,
  add column if not exists marketing_opt_in_at timestamptz;

alter table profiles drop constraint if exists profiles_first_name_shape;
alter table profiles add constraint profiles_first_name_shape check (
  first_name is null or (first_name = trim(first_name) and char_length(first_name) between 1 and 50));
alter table profiles drop constraint if exists profiles_last_name_shape;
alter table profiles add constraint profiles_last_name_shape check (
  last_name is null or (last_name = trim(last_name) and char_length(last_name) between 1 and 50));

-- The consent timestamp is set by the database, never by the client, so
-- it's a trustworthy record of when someone opted in or out.
create or replace function profiles_stamp_marketing_opt_in()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.marketing_opt_in_at := case when new.marketing_opt_in then now() end;
  elsif new.marketing_opt_in is distinct from old.marketing_opt_in then
    new.marketing_opt_in_at := now();
  else
    new.marketing_opt_in_at := old.marketing_opt_in_at;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_stamp_marketing_opt_in on profiles;
create trigger profiles_stamp_marketing_opt_in
  before insert or update on profiles
  for each row execute function profiles_stamp_marketing_opt_in();

-- 2. Sign-up trigger: also copy names + consent from the sign-up metadata.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  wanted text := nullif(trim(new.raw_user_meta_data ->> 'username'), '');
  first_n text := left(nullif(trim(new.raw_user_meta_data ->> 'first_name'), ''), 50);
  last_n text := left(nullif(trim(new.raw_user_meta_data ->> 'last_name'), ''), 50);
  opt_in boolean := coalesce((new.raw_user_meta_data ->> 'marketing_opt_in')::boolean, false);
begin
  -- Drop the requested name if it's already taken or malformed;
  -- onboarding will ask for another. Signup must never fail here.
  if wanted is not null and (
       char_length(wanted) not between 2 and 30
       or exists (select 1 from public.profiles p
                  where lower(p.username) = lower(wanted))
     ) then
    wanted := null;
  end if;

  insert into public.profiles (id, username, onboarding_completed, first_name, last_name, marketing_opt_in)
  values (new.id, wanted, false, trim(first_n), trim(last_n), opt_in)
  on conflict (id) do nothing;

  return new;

exception when others then
  -- Never block account creation on profile setup
  insert into public.profiles (id, username, onboarding_completed)
  values (new.id, null, false)
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Sign-up checks the username before creating the account, so people
-- aren't silently left without one. NOTE: this does expose something new.
-- Usernames weren't readable by anon before. See 20261123010000 for why
-- we accept it.
create or replace function is_username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1 from profiles where lower(username) = lower(trim(p_username))
  );
$$;
revoke all on function is_username_available(text) from public;
grant execute on function is_username_available(text) to anon, authenticated;

-- 3. Welcome email --------------------------------------------------------
create table if not exists welcome_email_log (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null check (status in ('sent', 'skipped', 'failed')),
  attempts int not null default 1,
  last_error text,
  updated_at timestamptz not null default now()
);
alter table welcome_email_log enable row level security;
revoke all on welcome_email_log from anon, authenticated;

-- Backfill rule: already onboarded → no welcome email.
insert into welcome_email_log (user_id, status)
select p.id, 'skipped'
from profiles p
where p.onboarding_completed = true
on conflict (user_id) do nothing;

-- Confirmed accounts still owed the email (failed ones retry up to 3 times).
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
    and u.email is not null
    and u.deleted_at is null
    and (u.banned_until is null or u.banned_until < now())
    and (l.user_id is null or (l.status = 'failed' and l.attempts < 3))
  order by u.email_confirmed_at
  limit greatest(1, least(p_limit, 100));
$$;
revoke all on function due_welcome_emails(int) from public, anon, authenticated;
grant execute on function due_welcome_emails(int) to service_role;

create or replace function log_welcome_email(p_user_id uuid, p_status text, p_error text default null)
returns void
language sql
security definer
set search_path = public
as $$
  insert into welcome_email_log (user_id, status, last_error)
  values (p_user_id, p_status, p_error)
  on conflict (user_id) do update
    set status = excluded.status,
        attempts = welcome_email_log.attempts + 1,
        last_error = excluded.last_error,
        updated_at = now();
$$;
revoke all on function log_welcome_email(uuid, text, text) from public, anon, authenticated;
grant execute on function log_welcome_email(uuid, text, text) to service_role;

-- 4. Cron: production-only, same pattern as the baseline jobs. Calling the
--    function before it's deployed is harmless (404).
do $cron$
begin
  create extension if not exists pg_cron;
  create extension if not exists pg_net;

  perform cron.schedule(
    'send-welcome-emails',
    '*/5 * * * *',
    $job$
    select net.http_post(
      url := 'https://qztxxldcbthivonokqij.supabase.co/functions/v1/send-welcome-emails',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret from vault.decrypted_secrets
          where name = 'service_role_key'
        )
      ),
      body := '{}'::jsonb
    );
    $job$
  );
exception when others then
  raise notice 'Skipping cron setup: %', sqlerrm;
end
$cron$;
