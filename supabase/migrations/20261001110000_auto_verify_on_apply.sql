-- Removes admin approval as a gate for first-time applicants — signing up
-- as a practitioner now grants immediate access to the dashboard. This is
-- a deliberate product decision, made explicitly aware that it removes the
-- only upfront vetting for who gets to see other real users' skin
-- profiles, routines, and (if granted) pregnancy status. Revoke
-- (20261001050000/60000/90000/100000) is now the sole moderation
-- mechanism — post-hoc rather than upfront.
--
-- Critically, this must NOT let a revoked practitioner silently
-- re-verify themselves by resubmitting this same form. The fix relies on
-- INSERT vs UPDATE: practitioners_prevent_self_verification only fires
-- BEFORE UPDATE (never INSERT), so a first-time applicant's INSERT can set
-- verified_at directly with nothing to block it, while the ON CONFLICT
-- UPDATE branch below never touches verified_at/verified_by/revoked_at at
-- all — so an existing row (verified and editing their profile, OR
-- revoked and trying to get back in) keeps exactly the status it already
-- had. Returns the resulting status so the client can show the right
-- message either way.
create or replace function submit_practitioner_application(
  p_display_name text,
  p_title text,
  p_bio text,
  p_specialisms text[],
  p_instagram text,
  p_whatsapp text
)
returns text -- 'verified' or 'pending'
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  insert into practitioners (user_id, display_name, title, bio, specialisms, instagram, whatsapp, verified_at)
  values (v_user_id, p_display_name, p_title, p_bio, p_specialisms, p_instagram, p_whatsapp, now())
  on conflict (user_id) do update set
    display_name = excluded.display_name,
    title = excluded.title,
    bio = excluded.bio,
    specialisms = excluded.specialisms,
    instagram = excluded.instagram,
    whatsapp = excluded.whatsapp;

  return case when (select verified_at from practitioners where user_id = v_user_id) is not null
    then 'verified' else 'pending' end;
end;
$$;

revoke all on function submit_practitioner_application(text, text, text, text[], text, text) from public, anon;
grant execute on function submit_practitioner_application(text, text, text, text[], text, text) to authenticated;
