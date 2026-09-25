-- A user exists before they pick a username; the app prompts via onboarding_completed
alter table public.profiles alter column username drop not null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, onboarding_completed)
  values (new.id, nullif(new.raw_user_meta_data ->> 'username', ''), false)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

insert into public.profiles (id, username, onboarding_completed)
select u.id, null, false
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);

-- Only the newest active routine per user per time_of_day stays active.
-- Nothing is deleted; the rest are archived.
with ranked as (
  select id,
         row_number() over (
           partition by user_id, time_of_day
           order by created_at desc, id desc
         ) as rn
  from routines
  where is_active
)
update routines r
set is_active = false
from ranked
where r.id = ranked.id
  and ranked.rn > 1;;
