-- Real bug, not a cache issue: care_relationships.practitioner_id,
-- recommendations.practitioner_id, and practitioner_access_log.practitioner_id
-- all have a foreign key to auth.users(id) only — never to practitioners
-- directly. PostgREST's automatic embedding (the `practitioners (...)` part
-- of every `.select()` that shows a client who their practitioner is) can
-- only resolve a relationship via a literal FK constraint between the two
-- named tables; it can't infer one through a shared grandparent table, even
-- though practitioners.user_id also references auth.users(id). Confirmed
-- directly against the live API:
--
--   PGRST200: Could not find a relationship between 'care_relationships'
--   and 'practitioners' in the schema cache
--
-- This has been broken since these queries were first written — nothing
-- exercised them with a real authenticated session (vs. an empty logged-out
-- check) until now. Fixed by adding a second FK straight to
-- practitioners(user_id) on each column, alongside the existing auth.users
-- one (kept for its ON DELETE CASCADE when an account is deleted outright,
-- practitioner or not). Verified zero existing rows would violate it before
-- writing this.
alter table care_relationships
  add constraint care_relationships_practitioner_fkey
  foreign key (practitioner_id) references practitioners(user_id);

alter table recommendations
  add constraint recommendations_practitioner_fkey
  foreign key (practitioner_id) references practitioners(user_id);

alter table practitioner_access_log
  add constraint practitioner_access_log_practitioner_fkey
  foreign key (practitioner_id) references practitioners(user_id);

-- Pulls a live-only fix back into the repo: the new FKs above mean
-- admin_review_practitioner's reject branch would now violate referential
-- integrity the moment any practitioner has a row in one of the three
-- newly-constrained tables — it deleted the practitioners row BEFORE the
-- rows that now reference it. The reviewer caught and fixed this before
-- applying, with the existence check moved above any deletes (so "No
-- pending application for that user" still fires correctly instead of
-- getting confused by partial cleanup) and children deleted first.
--
-- The three new FKs are deliberately NOT ON DELETE CASCADE — if a
-- practitioner somehow has practitioner_access_log entries, rejecting them
-- should fail loudly and force a human decision, not silently delete an
-- audit trail a client is entitled to see. In practice this reject branch
-- only ever runs against an unverified applicant (verified_at is null),
-- who can't have created a recommendation or been granted access-log
-- entries in the first place — these deletes are defensive, not expected
-- to ever remove real rows.
create or replace function admin_review_practitioner(target_id uuid, approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from auth.users u
    where u.id = auth.uid() and u.email = 'trackaplusapp@gmail.com'
  ) then
    raise exception 'Not authorized';
  end if;

  if target_id = auth.uid() then
    raise exception 'Cannot review your own application';
  end if;

  if approve then
    update practitioners
    set verified_at = now(), verified_by = auth.uid()
    where user_id = target_id and verified_at is null;

    if not found then
      raise exception 'No pending application for that user';
    end if;

    insert into admin_audit_log (actor_id, action, target_id, details)
    values (auth.uid(), 'approve_practitioner', target_id, '{}'::jsonb);
  else
    if not exists (select 1 from practitioners where user_id = target_id and verified_at is null) then
      raise exception 'No pending application for that user';
    end if;

    delete from care_relationships where practitioner_id = target_id;
    delete from recommendations where practitioner_id = target_id;
    delete from practitioner_access_log where practitioner_id = target_id;
    delete from invitations where practitioner_id = target_id;

    delete from practitioners where user_id = target_id and verified_at is null;

    insert into admin_audit_log (actor_id, action, target_id, details)
    values (auth.uid(), 'reject_practitioner', target_id, '{}'::jsonb);
  end if;
end;
$$;
