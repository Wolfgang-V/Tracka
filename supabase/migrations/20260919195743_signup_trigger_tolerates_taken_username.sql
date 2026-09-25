create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
$$;;
