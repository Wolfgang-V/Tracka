-- Replacing the breakouts/dryness/oiliness/redness steppers with a free-text
-- daily note. Reusing skin_logs (already one row per user per day) rather
-- than a new table — the numeric columns stay for existing history, just
-- unused by the new UI, and a fresh row from the notes-only flow gets their
-- defaults.
alter table skin_logs
  add column if not exists note text;
