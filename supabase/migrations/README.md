# Migration notes

## `security definer` functions: grants don't survive `create or replace`

`create or replace function` does **not** reset a function's privileges —
if you revoked `execute` from `anon`/`authenticated` when it was first
created, a later `create or replace` in a different migration keeps that
revoke.

But if a function is ever dropped and recreated fresh, or if a later
migration's `create or replace` simply doesn't repeat the revoke,
Supabase's default grants to `anon` and `authenticated` come back —
silently, with no error, no warning.

This has actually happened twice in this project:

- `due_reminders` — revoked correctly when created
  (`20260920053948_reminder_log_and_due_reminders.sql`), reopened by a
  later `create or replace` outside this repo's migration history.
- `admin_list_users` / `admin_delete_user` — both revoked correctly on
  first creation, both reopened by later migrations in this repo that
  redefined them without repeating the revoke
  (`20260925100000_reapply_admin_function_grants.sql` fixed this).

Neither became a full security hole, because both functions also check
the caller's identity internally (`auth.uid()` against a hardcoded email
or the row being modified) — an unauthorized caller still got `Not
authorized` back, not data. But the grant itself should never have
reopened, and relying on the internal check as the only layer is not the
plan.

**The rule:** any migration that does `create or replace function` on a
`security definer` function must end with its own `revoke`/`grant`
pair, every time — even if nothing about permissions looks like it
changed, even if the previous migration already set it correctly. Don't
assume a grant persists across a `create or replace` in a *different*
file just because it persists within the same one.
