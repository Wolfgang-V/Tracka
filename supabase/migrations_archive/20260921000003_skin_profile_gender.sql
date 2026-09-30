-- Gender field on the skin profile, collected alongside skin type/concerns
-- during onboarding (Step 1 of 3). skin_profiles predates this migration
-- folder, so this only adds the new column rather than creating the table.
alter table skin_profiles
  add column if not exists gender text;
