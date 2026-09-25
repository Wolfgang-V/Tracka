-- morning_time / night_time are clock times with no timezone attached.
-- The cron needs to know whose clock, or 7am means nothing.
alter table reminder_settings
  add column if not exists timezone text not null default 'Africa/Lagos';;
