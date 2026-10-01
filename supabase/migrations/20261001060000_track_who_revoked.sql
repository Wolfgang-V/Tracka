-- revoke_care_access() became bidirectional in 20261001050000, which made
-- status = 'revoked' ambiguous — a client seeing it can't tell whether
-- they ended it or the practitioner did, and for someone who's been
-- dropped that distinction matters. revoked_at already existed; revoked_by
-- is its natural pair.
alter table care_relationships add column if not exists revoked_by uuid references auth.users(id);

create or replace function revoke_care_access(p_relationship_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update care_relationships
  set status = 'revoked', revoked_at = now(), revoked_by = auth.uid()
  where id = p_relationship_id
    and (client_id = auth.uid() or practitioner_id = auth.uid())
    and status in ('invited', 'active');

  if not found then
    raise exception 'Relationship not found or already revoked';
  end if;
end;
$$;
