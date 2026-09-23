-- Ingredient text captured from Open Beauty Facts when a product is added
-- via the live search (Add Product screen). Free text, not parsed — used
-- by detectActive() as an extra signal alongside name/brand/category, so
-- actives that aren't named in the product title can still be caught.
alter table products
  add column if not exists ingredients text;
