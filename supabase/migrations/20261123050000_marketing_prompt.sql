-- One-time "Get skincare tips by email?" card on Today.
--
-- Nobody who signed up before 23 Nov 2026 was ever asked about promotional
-- email, so the opt-in list (for Zoho campaigns) is empty. The app now asks
-- once, on Today: "Yes, email me" sets marketing_opt_in (the existing trigger
-- stamps marketing_opt_in_at as the consent record); "No thanks" just records
-- that we asked. Either way marketing_prompted_at is set, so it never asks
-- again, on any device.
--
-- New sign-ups already answered the checkbox on the sign-up form, so
-- handle_new_user sets marketing_prompted_at for them (only when the form
-- sent the field, i.e. the new form), and they're never asked twice.
--
-- Ship order: this migration FIRST, then the app. The app reads and writes
-- marketing_prompted_at, which doesn't exist before this.

alter table profiles add column if not exists marketing_prompted_at timestamptz;

-- Same as 20261123000000's version (live md5 a167884b… checked 2026-11-23),
-- plus marketing_prompted_at.
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
  asked boolean := new.raw_user_meta_data ? 'marketing_opt_in';
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

  insert into public.profiles (id, username, onboarding_completed, first_name, last_name, marketing_opt_in, marketing_prompted_at)
  values (new.id, wanted, false, trim(first_n), trim(last_n), opt_in, case when asked then now() end)
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
