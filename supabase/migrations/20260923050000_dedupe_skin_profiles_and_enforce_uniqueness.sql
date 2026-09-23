-- skin_profiles has accumulated duplicate rows per user (41 rows / 7 users
-- as of 2026-09-23) because onboarding always INSERTs a new row instead of
-- updating the existing one. This keeps the most recent row per user,
-- deletes the rest, and adds a unique constraint on user_id so it can't
-- happen again. The app's save handler is changed to upsert on user_id to
-- match (see src/App.jsx skin profile save).
--
-- Run this SELECT yourself in the SQL editor BEFORE running this migration,
-- to see exactly which rows will be removed:
--
--   select *
--   from skin_profiles sp
--   where sp.id not in (
--     select distinct on (user_id) id
--     from skin_profiles
--     order by user_id, created_at desc nulls last, id desc
--   )
--   order by sp.user_id, sp.created_at;
--
-- Assumes the primary key column is named "id" — same convention as every
-- other table in this schema (routines.id, user_products.id, etc). Check
-- that against the live table before running if you're unsure.

delete from skin_profiles
where id not in (
  select distinct on (user_id) id
  from skin_profiles
  order by user_id, created_at desc nulls last, id desc
);

alter table skin_profiles
  add constraint skin_profiles_user_id_key unique (user_id);
