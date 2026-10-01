-- "You can't definitely know their email" — real problem with
-- practitioner_invite_by_email as the only path. The fix isn't letting
-- practitioners browse/search onboarded users (that would expose every
-- user's name to any verified practitioner, which breaks the consent-first
-- premise this whole feature is built on). It's recognizing that
-- accept_invitation() never actually validates invited_email against the
-- person who redeems the link — "whoever is signed in when they open the
-- link redeems it" was already the documented design. The email/phone
-- fields are just the practitioner's own memory aid for who they sent
-- which link to. So a link doesn't need a real email at all — a label the
-- practitioner recognizes ("Sarah from Instagram") works exactly the same.

alter table invitations add column if not exists label text;

alter table invitations drop constraint if exists invitations_check;
alter table invitations add constraint invitations_check
  check (invited_email is not null or invited_phone is not null or label is not null);

-- Mirrors practitioner_invite_by_email's shape (same auth check, same
-- scopes validation) but skips the auth.users email lookup entirely —
-- every call here makes a token-based invitation, no existing-account
-- branch, since there's no email to look anyone up by.
create or replace function practitioner_create_invite_link(p_label text, p_scopes text[])
returns uuid -- the invitation token
language plpgsql
security definer
set search_path = public
as $$
declare
  v_practitioner_id uuid := auth.uid();
  v_token uuid;
begin
  if not exists (
    select 1 from practitioners pr
    where pr.user_id = v_practitioner_id and pr.verified_at is not null
  ) then
    raise exception 'Not authorized';
  end if;

  if p_scopes is null or not (p_scopes <@ array['skin_profile', 'routine', 'daily_logs', 'photos', 'pregnancy_status']::text[]) then
    raise exception 'Invalid scopes';
  end if;

  insert into invitations (practitioner_id, label, scopes)
  values (v_practitioner_id, nullif(trim(p_label), ''), p_scopes)
  returning token into v_token;

  return v_token;
end;
$$;

revoke all on function practitioner_create_invite_link(text, text[]) from public, anon;
grant execute on function practitioner_create_invite_link(text, text[]) to authenticated;
