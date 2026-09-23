-- Columns and policies that were previously only given as inline SQL in
-- chat, never captured as a migration. If you already ran the original
-- "alter table user_products add column opened_date..." snippet by hand,
-- these `if not exists` / `drop policy if exists` guards make re-running
-- this file a no-op rather than an error.

-- Period-after-opening tracking (Products screen, planNight expiry check).
alter table user_products
  add column if not exists opened_date date,
  add column if not exists pao_months integer;

-- Per-step frequency (planNight's overdue/rotation logic).
alter table routine_steps
  add column if not exists frequency text;

-- The Settings screen upserts { id: auth.uid(), username } into profiles.
-- Without this policy that upsert silently fails under RLS.
alter table profiles enable row level security;

drop policy if exists "Users manage their own profile" on profiles;

create policy "Users manage their own profile"
  on profiles
  for all
  using (auth.uid() = id)
  with check (auth.uid() = id);
