-- accept_invitation() has never checked who redeems a token, and with
-- label-only links (20261001030000) there may be no email at all to even
-- nominally check — the token itself is the only credential. A link
-- shared in a group chat grants the scopes it carries to whoever taps it
-- first, correct claim or not. revoke_care_access() only let the client
-- undo that (checked client_id = auth.uid()) — a practitioner who
-- discovers the wrong person claimed their link had no way to undo it
-- themselves. Letting either side end the relationship closes that.
create or replace function revoke_care_access(p_relationship_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update care_relationships
  set status = 'revoked', revoked_at = now()
  where id = p_relationship_id
    and (client_id = auth.uid() or practitioner_id = auth.uid())
    and status in ('invited', 'active');

  if not found then
    raise exception 'Relationship not found or already revoked';
  end if;
end;
$$;
