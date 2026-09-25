-- Collapse the three historical formats into one vocabulary.
-- Day-of-week lists become a cadence, since the engine works from
-- what was actually used rather than a fixed weekday.
update routine_steps
set frequency = case
  when frequency is null            then 'daily'
  when frequency = 'daily'          then 'daily'
  when upper(frequency) = 'EVERY_DAY' then 'daily'
  when frequency = '3x'             then 'alternate'      -- 3 a week ≈ every other night
  when frequency = '2x'             then 'twice_week'
  when frequency = '1x'             then 'once_week'
  when frequency = 'MON,WED,FRI'    then 'alternate'
  when frequency = 'TUE,THU'        then 'twice_week'
  else 'daily'
end;

alter table routine_steps alter column frequency set default 'daily';
alter table routine_steps alter column frequency set not null;

alter table routine_steps
  add constraint routine_steps_frequency_check
  check (frequency in ('daily','alternate','every3','twice_week','once_week'));;
