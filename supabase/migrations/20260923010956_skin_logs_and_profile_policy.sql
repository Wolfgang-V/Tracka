create table if not exists skin_logs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  breakouts  integer not null default 0,
  dryness    integer not null default 0,
  oiliness   integer not null default 0,
  redness    integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (user_id, local_date)
);

alter table skin_logs enable row level security;

drop policy if exists "Users manage their own skin log" on skin_logs;

create policy "Users manage their own skin log"
  on skin_logs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Keep the 0-10 scale honest; the UI is a stepper, but the API isn't.
alter table skin_logs
  add constraint skin_logs_scores_check
  check (
    breakouts between 0 and 10 and dryness  between 0 and 10 and
    oiliness  between 0 and 10 and redness  between 0 and 10
  );

alter table user_products
  add column if not exists opened_date date,
  add column if not exists pao_months  integer;

alter table routine_steps add column if not exists frequency text;
alter table products      add column if not exists ingredients text;
alter table skin_profiles add column if not exists gender text;

alter table profiles enable row level security;

-- Deliberately NOT "for all": a FOR ALL policy also grants DELETE, which
-- would let a user destroy their own profile row while their auth.users
-- row survives. The signup trigger only fires on insert, so nothing would
-- ever recreate it and they'd be permanently nameless.
drop policy if exists "Users manage their own profile" on profiles;

create policy "Users insert their own profile"
  on profiles for insert
  with check (auth.uid() = id);;
