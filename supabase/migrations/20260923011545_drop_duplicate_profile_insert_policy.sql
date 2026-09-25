-- "Users can create their own profile" already exists with an identical
-- with_check. Keeping that one; this was the duplicate I added.
drop policy if exists "Users insert their own profile" on profiles;;
