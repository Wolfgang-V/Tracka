-- "Mark as expired": a product can go off (smell, texture, separation)
-- before its date — or have no date set at all. marked_expired_at records
-- that the person declared it expired; the app treats it exactly like a
-- product past its use-by date (shown under Expired). Cleared if they undo.
--
-- A separate column rather than overwriting expiry_date, so the printed
-- date on the pack is never lost.

alter table user_products
  add column if not exists marked_expired_at timestamptz;
