alter table user_products
  add column if not exists opened_date date,
  add column if not exists pao_months integer;

-- PAO is the 6M / 12M symbol on the packaging. Keep it sane.
alter table user_products
  add constraint user_products_pao_months_check
  check (pao_months is null or pao_months between 1 and 60);

-- Can't have been opened in the future.
alter table user_products
  add constraint user_products_opened_date_check
  check (opened_date is null or opened_date <= (now() at time zone 'Africa/Lagos')::date);;
