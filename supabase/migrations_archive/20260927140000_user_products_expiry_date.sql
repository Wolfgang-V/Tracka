-- A printed manufacturer expiry date, separate from opened_date/pao_months.
-- PAO ("period after opening") only starts counting once a product is
-- opened; a lot of products also carry a hard expiry printed on the box
-- that applies whether or not it's been opened yet. Nullable and
-- independent of opened_date — a product can have either, both, or neither.
alter table user_products
  add column if not exists expiry_date date;
