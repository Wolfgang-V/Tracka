-- Daily skin-condition log. One row per user per day, upserted like
-- routine_completions. opened_date on user_products (already added for
-- PAO tracking) doubles as the "introduced" date for the product
-- correlation feature, so no extra column is needed there.
create table if not exists skin_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  breakouts integer not null default 0,
  dryness integer not null default 0,
  oiliness integer not null default 0,
  redness integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (user_id, local_date)
);

alter table skin_logs enable row level security;

drop policy if exists "Users manage their own skin log" on skin_logs;

create policy "Users manage their own skin log"
  on skin_logs
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
