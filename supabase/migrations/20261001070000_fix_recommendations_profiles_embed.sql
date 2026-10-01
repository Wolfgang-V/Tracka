-- Same bug class as 20261001020000, one more instance it didn't cover:
-- that migration added direct FKs from practitioner_id columns to
-- practitioners(user_id), fixing every `practitioners (...)` embed, but
-- loadPractitionerRecommendations() also embeds `profiles:client_id
-- (username)` — recommendations.client_id and profiles.id both reference
-- auth.users(id), with no direct FK between recommendations and profiles
-- themselves, so PostgREST can't resolve that embed either. Surfaced by
-- the practitioner's own "Routines" history screen on first real use.
alter table recommendations
  add constraint recommendations_client_fkey
  foreign key (client_id) references profiles(id);
