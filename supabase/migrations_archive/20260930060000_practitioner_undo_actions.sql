-- Four gaps from review: practitioners could create recommendations,
-- recommendation items, and invitations, but never undo any of them, and
-- the client-response trigger pinned every column except the one that
-- actually mattered — status itself could be set to anything.

-- ---------------------------------------------------------------
-- 1 & 4. Recommendations: practitioners can withdraw a still-pending one;
--    clients can only ever land on accepted/declined. Replaces the
--    earlier client-only trigger with one that governs both directions,
--    so there's one place that knows the full set of legal transitions.
-- ---------------------------------------------------------------
create policy "Practitioners can withdraw their own proposed recommendations"
  on recommendations for update
  using (auth.uid() = practitioner_id and status = 'proposed')
  with check (auth.uid() = practitioner_id);

drop trigger if exists recommendations_lock_client_fields on recommendations;
drop function if exists lock_recommendation_fields_for_client();

create or replace function lock_recommendation_fields()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() = old.client_id then
    -- A client can only accept or decline what was proposed to them —
    -- not edit it, not reassign it, not move it to any other status.
    new.practitioner_id := old.practitioner_id;
    new.client_id := old.client_id;
    new.note := old.note;
    new.created_at := old.created_at;

    if new.status not in ('accepted', 'declined') then
      raise exception 'Clients can only accept or decline a recommendation';
    end if;

  elsif auth.uid() = old.practitioner_id then
    -- A practitioner can only withdraw one that's still pending — once a
    -- client has responded, the record of what was proposed is final.
    new.practitioner_id := old.practitioner_id;
    new.client_id := old.client_id;
    new.note := old.note;
    new.created_at := old.created_at;

    if old.status <> 'proposed' or new.status <> 'superseded' then
      raise exception 'Practitioners can only withdraw a still-pending recommendation';
    end if;
  end if;

  return new;
end;
$$;

create trigger recommendations_lock_fields
  before update on recommendations
  for each row execute function lock_recommendation_fields();

-- ---------------------------------------------------------------
-- 2. recommendation_items: edit or remove, but only while the parent
--    recommendation is still proposed — once a client's responded, the
--    record of what was actually offered shouldn't move.
-- ---------------------------------------------------------------
create policy "Practitioners can edit items on their own proposed recommendations"
  on recommendation_items for update
  using (
    exists (
      select 1 from recommendations r
      where r.id = recommendation_items.recommendation_id
        and r.practitioner_id = auth.uid()
        and r.status = 'proposed'
    )
  )
  with check (
    exists (
      select 1 from recommendations r
      where r.id = recommendation_items.recommendation_id
        and r.practitioner_id = auth.uid()
        and r.status = 'proposed'
    )
  );

create policy "Practitioners can remove items from their own proposed recommendations"
  on recommendation_items for delete
  using (
    exists (
      select 1 from recommendations r
      where r.id = recommendation_items.recommendation_id
        and r.practitioner_id = auth.uid()
        and r.status = 'proposed'
    )
  );

-- ---------------------------------------------------------------
-- 3. invitations: cancel one that hasn't been redeemed yet. Deleting
--    rather than adding a "cancelled" status — an unused, cancelled
--    invitation has no future use worth keeping a row around for, unlike
--    a recommendation (which stays as a record even once superseded).
-- ---------------------------------------------------------------
create policy "Practitioners can cancel their own unused invitations"
  on invitations for delete
  using (auth.uid() = practitioner_id and used_at is null);
