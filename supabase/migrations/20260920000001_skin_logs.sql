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

-- The UI stepper stays within 0-10, but nothing stops a raw REST call from
-- sending anything else — bound it at the schema so the chart data can't
-- become meaningless.
alter table skin_logs
  drop constraint if exists skin_logs_breakouts_check,
  drop constraint if exists skin_logs_dryness_check,
  drop constraint if exists skin_logs_oiliness_check,
  drop constraint if exists skin_logs_redness_check;

alter table skin_logs
  add constraint skin_logs_breakouts_check check (breakouts between 0 and 10),
  add constraint skin_logs_dryness_check check (dryness between 0 and 10),
  add constraint skin_logs_oiliness_check check (oiliness between 0 and 10),
  add constraint skin_logs_redness_check check (redness between 0 and 10);

alter table skin_logs enable row level security;

drop policy if exists "Users manage their own skin log" on skin_logs;

create policy "Users manage their own skin log"
  on skin_logs
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
