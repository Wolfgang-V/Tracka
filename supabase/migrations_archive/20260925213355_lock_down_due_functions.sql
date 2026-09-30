-- These are security definer and return other users' push credentials.
-- Revoking from anon/authenticated alone is not enough: they inherit from
-- PUBLIC, which keeps execute by default on every create or replace.
revoke all on function due_reminders(int)          from public, anon, authenticated;
revoke all on function due_followups(int)          from public, anon, authenticated;
revoke all on function due_inactivity_nudges()     from public, anon, authenticated;
revoke all on function due_onboarding_nudges()     from public, anon, authenticated;

revoke all on function create_routine(text, jsonb, jsonb) from public;
grant execute on function create_routine(text, jsonb, jsonb) to authenticated;;
