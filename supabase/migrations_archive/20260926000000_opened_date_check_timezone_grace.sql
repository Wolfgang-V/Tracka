-- user_products_opened_date_check rejects opened_date > today in
-- Africa/Lagos specifically. A tester (or any user) in a timezone ahead
-- of Lagos can have their own local calendar day roll over before
-- Lagos's does — entering the literal current date from their own device
-- then reads as "in the future" and the insert fails. A one-day grace
-- window absorbs that skew without meaningfully weakening the check
-- (it's still catching genuine typos like a year in the future, not
-- policing exact midnight boundaries across timezones the app was never
-- told about).
alter table user_products
  drop constraint if exists user_products_opened_date_check;

alter table user_products
  add constraint user_products_opened_date_check
  check (
    opened_date is null
    or opened_date <= ((now() at time zone 'Africa/Lagos')::date + 1)
  );
