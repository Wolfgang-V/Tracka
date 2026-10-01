-- "Find a professional" — the other direction of discovery. Practitioners
-- can now reach clients (by email or invite link); clients had no way to
-- reach a practitioner unless one had already found them first.
--
-- Turns out the SELECT access this needs already existed, but wider than
-- intended: "Anyone signed in can view practitioner profiles" was
-- unconditional (qual: true), so a pending, unverified application was
-- already visible to every logged-in user — contradicting the stated
-- design that nothing about a practitioner unlocks until verified_at is
-- set. Replacing it with the scoped version closes that gap and is exactly
-- what "Find a professional" needs: any authenticated user can see a
-- VERIFIED practitioner's own business-profile fields (what they filled in
-- to be listed — name, title, bio, specialisms, contact info), nothing
-- about an unverified applicant, and nothing about anyone's clients or
-- activity.
drop policy if exists "Anyone signed in can view practitioner profiles" on practitioners;

create policy "Anyone can browse verified practitioner profiles"
  on practitioners for select
  using (verified_at is not null or auth.uid() = user_id);
