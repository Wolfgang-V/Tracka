-- The daily "Heading out today?" prompt this table backed has been
-- removed from the client (see 20260928120000_spf_fixed_times_drop_checkin_gate.sql,
-- which also dropped the gate in due_spf_reminders that read it). Nothing
-- writes to or reads this table anymore.
drop table if exists spf_daily_checkin;
