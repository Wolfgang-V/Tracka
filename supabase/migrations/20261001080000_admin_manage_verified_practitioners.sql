-- Real gap: once a practitioner is approved, they vanish from admin
-- visibility entirely — "Approvals" only ever shows pending applications.
-- There was no way to review who's currently verified, or to revoke a
-- practitioner's status if something turns out to be wrong after the fact.
-- For a feature that grants access to other people's skin profiles and
-- routines, that's a real trust/safety gap, not just a UX nicety.

create or replace function admin_list_verified_practitioners()
returns table (
  user_id uuid,
  email text,
  display_name text,
  title text,
  bio text,
  specialisms text[],
  instagram text,
  whatsapp text,
  verified_at timestamptz,
  client_count bigint
)
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

  return query
  select
    pr.user_id, u.email::text, pr.display_name, pr.title, pr.bio,
    pr.specialisms, pr.instagram, pr.whatsapp, pr.verified_at,
    (select count(*) from care_relationships cr
      where cr.practitioner_id = pr.user_id and cr.status = 'active')
  from practitioners pr
  join auth.users u on u.id = pr.user_id
  where pr.verified_at is not null
  order by pr.verified_at desc;
end;
$$;

revoke all on function admin_list_verified_practitioners() from public, anon;
grant execute on function admin_list_verified_practitioners() to authenticated;

-- Revokes verification without touching any history — care_relationships,
-- recommendations and practitioner_access_log all stay exactly as they
-- are, same reasoning as everywhere else in this feature (a client is
-- entitled to the record of what happened). Nulling verified_at is enough
-- on its own: has_client_access() requires it non-null, so this cuts off
-- every scope-gated read immediately across every table, with nothing
-- else to change.
create or replace function admin_revoke_practitioner(target_id uuid)
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

  update practitioners
  set verified_at = null, verified_by = null
  where user_id = target_id and verified_at is not null;

  if not found then
    raise exception 'No verified practitioner found for that user';
  end if;

  insert into admin_audit_log (actor_id, action, target_id, details)
  values (auth.uid(), 'revoke_practitioner', target_id, '{}'::jsonb);
end;
$$;

revoke all on function admin_revoke_practitioner(uuid) from public, anon;
grant execute on function admin_revoke_practitioner(uuid) to authenticated;
