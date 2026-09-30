-- One day's slack: a user east of Lagos can legitimately be on tomorrow's
-- date when they open a product. UTC+14 is the furthest ahead any real
-- timezone goes, so +1 covers everyone.
alter table user_products
  drop constraint if exists user_products_opened_date_check;

alter table user_products
  add constraint user_products_opened_date_check
  check (
    opened_date is null
    or opened_date <= ((now() at time zone 'Africa/Lagos')::date + 1)
  );;
