-- Columns and policies that were previously only given as inline SQL in
-- chat, never captured as a migration. If you already ran the original
-- "alter table user_products add column opened_date..." snippet by hand,
-- these `if not exists` / `drop policy if exists` guards make re-running
-- this file a no-op rather than an error.

-- Period-after-opening tracking (Products screen, planNight expiry check).
-- Bounded 1-60: it's a real product-safety number, not free text — an
-- unconstrained value would let a bad client push something nonsensical
-- into the PAO expiry check.
alter table user_products
  add column if not exists opened_date date,
  add column if not exists pao_months integer;

alter table user_products
  drop constraint if exists user_products_pao_months_check;

alter table user_products
  add constraint user_products_pao_months_check
  check (pao_months is null or pao_months between 1 and 60);

-- Per-step frequency (planNight's overdue/rotation logic). Constrained to
-- exactly the five values FREQUENCIES in planNight.js understands —
-- anything else and planNight silently treats the step as daily, which
-- defeats the point of setting a frequency at all.
alter table routine_steps
  add column if not exists frequency text not null default 'daily';

alter table routine_steps
  drop constraint if exists routine_steps_frequency_check;

alter table routine_steps
  add constraint routine_steps_frequency_check
  check (frequency in ('daily', 'alternate', 'every3', 'twice_week', 'once_week'));

-- The Settings screen upserts { id: auth.uid(), username } into profiles.
-- SELECT and UPDATE policies already exist on this table; this adds
-- INSERT only. Deliberately not `for all` — that would also grant DELETE,
-- and since a profile row is only (re)created by the signup trigger, a
-- user deleting their own row would leave them permanently without a
-- profile with no path back to one.
alter table profiles enable row level security;

drop policy if exists "Users manage their own profile" on profiles;
drop policy if exists "Users insert their own profile" on profiles;

create policy "Users insert their own profile"
  on profiles
  for insert
  with check (auth.uid() = id);
