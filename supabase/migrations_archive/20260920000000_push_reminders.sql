-- Push reminders: schema + cron wiring for supabase/functions/send-reminders.
--
-- Run this in the Supabase SQL editor (or `supabase db push`), then read
-- the "MANUAL STEP" block at the bottom before running the cron.schedule
-- call — it needs your own service role key, which must never be committed.

-- One subscription per user (re-subscribing overwrites the old one).
create table if not exists push_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  subscription jsonb not null,
  updated_at timestamptz not null default now()
);

alter table push_subscriptions enable row level security;

drop policy if exists "Users manage their own push subscription" on push_subscriptions;

create policy "Users manage their own push subscription"
  on push_subscriptions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- The Edge Function needs each user's IANA timezone to know when their
-- local morning/night reminder time actually falls. The client captures
-- this automatically (Intl.DateTimeFormat) whenever reminder settings save.
alter table reminder_settings
  add column if not exists timezone text;

-- ---------------------------------------------------------------------
-- MANUAL STEP — do not run this part blind, and do not commit real
-- secrets into this file.
--
-- 1. Enable the extensions (Database -> Extensions in the dashboard, or):
--      create extension if not exists pg_cron with schema extensions;
--      create extension if not exists pg_net with schema extensions;
--
-- 2. Store your service role key in Vault (Settings -> API for the key;
--    run this once, in the SQL editor, with your real key substituted —
--    never paste it into a file that gets committed):
--      select vault.create_secret('<your-service-role-key>', 'service_role_key');
--
-- 3. Schedule the cron job (replace <project-ref> with your project ref):
--      select cron.schedule(
--        'send-reminders-every-5-min',
--        '*/5 * * * *',
--        $$
--        select net.http_post(
--          url := 'https://<project-ref>.supabase.co/functions/v1/send-reminders',
--          headers := jsonb_build_object(
--            'Content-Type', 'application/json',
--            'Authorization', 'Bearer ' || (
--              select decrypted_secret from vault.decrypted_secrets
--              where name = 'service_role_key'
--            )
--          ),
--          body := '{}'::jsonb
--        ) as request_id;
--        $$
--      );
-- ---------------------------------------------------------------------
