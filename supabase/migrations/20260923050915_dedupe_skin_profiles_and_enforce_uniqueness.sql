-- Keep the newest row per user; 36 of 44 rows go. Verified beforehand that
-- no surviving row has fewer filled answers than any row being removed.
delete from skin_profiles sp
where sp.id not in (
  select distinct on (user_id) id
  from skin_profiles
  order by user_id, created_at desc nulls last, id desc
);

-- Required by the shipped upsert; also stops the double-tap duplicates.
alter table skin_profiles
  add constraint skin_profiles_user_id_key unique (user_id);;
