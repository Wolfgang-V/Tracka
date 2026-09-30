-- Anyone with a routine got through onboarding; the flag was never set
-- because nothing in the app wrote it.
update profiles p
set onboarding_completed = true
where p.onboarding_completed = false
  and exists (select 1 from routines r where r.user_id = p.id);;
