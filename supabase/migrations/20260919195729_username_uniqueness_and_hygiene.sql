-- Clean existing values before constraining them
update profiles
set username = trim(username)
where username is not null and username <> trim(username);

-- Case-insensitive uniqueness; display casing is preserved as entered.
-- Partial index so the null usernames from backfill don't collide with each other.
create unique index profiles_username_lower_key
  on profiles (lower(username))
  where username is not null;

-- No leading/trailing whitespace, sensible length
alter table profiles
  add constraint profiles_username_trimmed
  check (username is null or username = trim(username));

alter table profiles
  add constraint profiles_username_length
  check (username is null or char_length(username) between 2 and 30);;
