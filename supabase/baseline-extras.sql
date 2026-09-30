-- Objects that live outside the public schema, which `supabase db dump`
-- does not capture. Appended to the end of supabase/baseline.sql after
-- that file is generated.
--
-- 1. the signup trigger  (auth schema — excluded by the dump)
-- 2. the cron jobs       (cron schema — not schema at all, they're rows)
--
-- The cron commands read the service role key from Vault, so there is no
-- secret in this file. The Vault secret itself is NOT in here and must be
-- recreated by hand on any new project:
--   select vault.create_secret('<service role key>', 'service_role_key');

-- ---------------------------------------------------------------
-- 1. Profile row on signup
-- ---------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  wanted text := nullif(trim(new.raw_user_meta_data ->> 'username'), '');
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

  insert into public.profiles (id, username, onboarding_completed)
  values (new.id, wanted, false)
  on conflict (id) do nothing;

  return new;

exception when others then
  -- Never block account creation on profile setup
  insert into public.profiles (id, username, onboarding_completed)
  values (new.id, null, false)
  on conflict (id) do nothing;
  return new;
end;
$function$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------
-- 2. Scheduled jobs
-- ---------------------------------------------------------------

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('send-routine-reminders')
where exists (select 1 from cron.job where jobname = 'send-routine-reminders');

select cron.schedule(
  'send-routine-reminders',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://qztxxldcbthivonokqij.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'service_role_key'
      )
    )
  );
  $$
);

select cron.unschedule('storage-cleanup-daily')
where exists (select 1 from cron.job where jobname = 'storage-cleanup-daily');

select cron.schedule(
  'storage-cleanup-daily',
  '17 3 * * *',
  $$
  select net.http_post(
    url := 'https://qztxxldcbthivonokqij.supabase.co/functions/v1/storage-cleanup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'service_role_key'
      )
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
