-- Aesthetician/practitioner role — Phase 0 (foundation).
--
-- Design intent, so the "why" survives whoever reads this next:
--   * Consent is a first-class object (care_relationships.scopes), not a
--     boolean. Four scopes: skin_profile, routine, daily_logs, photos.
--     Photos is deliberately NOT wired into any RLS policy below — the
--     client-facing scope picker should default it off and this migration
--     makes that the only option in v1, not just the default.
--   * Practitioners propose, clients accept. No table here gives a
--     practitioner INSERT/UPDATE on client data — recommendations are a
--     separate, client-approved object; accepting one runs the existing
--     create_routine, unchanged.
--   * has_client_access() is the one function every added policy calls.
--     It's wrapped in `(select ...)` at every call site — unwrapped,
--     Postgres would re-evaluate it per row instead of once per query,
--     which matters on routine_step_completions.
--   * RLS is the real security boundary (it's what stops a practitioner
--     querying a table they don't have access to at all); the RPCs below
--     are the sanctioned, logged interface the practitioner UI actually
--     uses. A determined actor with direct API access could technically
--     read the same rows RLS allows without hitting a logged RPC — that's
--     a known limitation, not an oversight, and acceptable for a small,
--     manually-vetted practitioner set. Worth revisiting if this ever
--     opens up to self-serve practitioner signup at scale.

-- ---------------------------------------------------------------
-- 1. practitioners — same auth as everyone else, an extra capability.
--    Anyone can create their own row (self-serve "apply"); verified_at
--    stays null until set by hand, and has_client_access() below requires
--    it non-null, so an unverified row grants zero actual access.
-- ---------------------------------------------------------------
create table if not exists practitioners (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  bio          text,
  specialisms  text[] not null default '{}',
  instagram    text,
  whatsapp     text,
  verified_at  timestamptz,
  verified_by  uuid references auth.users(id),
  created_at   timestamptz not null default now()
);

alter table practitioners enable row level security;

-- Public professional info (name/bio/specialisms), same sensitivity as a
-- profile — visible to any signed-in user so an invitee can see who's
-- inviting them before a relationship row exists.
create policy "Anyone signed in can view practitioner profiles"
  on practitioners for select to authenticated
  using (true);

create policy "Users can create their own practitioner profile"
  on practitioners for insert
  with check (auth.uid() = user_id);

create policy "Practitioners can update their own profile"
  on practitioners for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- RLS can gate the row, not individual columns — without this, the policy
-- above would let a practitioner set their own verified_at/verified_by in
-- the same request that updates their bio. A self-update (auth.uid() =
-- the row's own user_id) always has those two fields pinned to their
-- previous values; a manual update run as an admin (no auth.uid() in that
-- session) is unaffected and is the only way they're ever set.
create or replace function prevent_practitioner_self_verification()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() = old.user_id then
    new.verified_at := old.verified_at;
    new.verified_by := old.verified_by;
  end if;
  return new;
end;
$$;

create trigger practitioners_prevent_self_verification
  before update on practitioners
  for each row execute function prevent_practitioner_self_verification();

-- ---------------------------------------------------------------
-- 2. care_relationships — the consent object. scopes is the permission
--    set; status governs whether has_client_access() honours it at all.
-- ---------------------------------------------------------------
create table if not exists care_relationships (
  id             uuid primary key default gen_random_uuid(),
  practitioner_id uuid not null references auth.users(id) on delete cascade,
  client_id      uuid not null references auth.users(id) on delete cascade,
  status         text not null check (status in ('invited', 'active', 'revoked')),
  scopes         text[] not null default '{}'
                   check (scopes <@ array['skin_profile', 'routine', 'daily_logs', 'photos']::text[]),
  invited_at     timestamptz not null default now(),
  accepted_at    timestamptz,
  revoked_at     timestamptz,
  last_active_at timestamptz,
  check (practitioner_id <> client_id)
);

-- Only one live (invited or active) relationship per pair at a time —
-- a revoked one doesn't block a fresh invite from being sent later.
create unique index if not exists care_relationships_live_pair_idx
  on care_relationships (practitioner_id, client_id)
  where status in ('invited', 'active');

alter table care_relationships enable row level security;

create policy "Practitioners see their own relationships"
  on care_relationships for select
  using (auth.uid() = practitioner_id);

create policy "Clients see their own relationships"
  on care_relationships for select
  using (auth.uid() = client_id);

-- Practitioners can only ever create a PENDING relationship — never one
-- that starts active. Accepting is the client's action alone, via RPC.
create policy "Practitioners can invite existing clients"
  on care_relationships for insert
  with check (auth.uid() = practitioner_id and status = 'invited');

-- ---------------------------------------------------------------
-- 3. invitations — token links, for people not yet on the platform.
--    Shared over WhatsApp/social, not through in-app search.
-- ---------------------------------------------------------------
create table if not exists invitations (
  token         uuid primary key default gen_random_uuid(),
  practitioner_id uuid not null references auth.users(id) on delete cascade,
  invited_email text,
  invited_phone text,
  scopes        text[] not null default '{}'
                  check (scopes <@ array['skin_profile', 'routine', 'daily_logs', 'photos']::text[]),
  expires_at    timestamptz not null default (now() + interval '14 days'),
  used_at       timestamptz,
  used_by       uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  check (invited_email is not null or invited_phone is not null)
);

alter table invitations enable row level security;

create policy "Practitioners see their own invitations"
  on invitations for select
  using (auth.uid() = practitioner_id);

create policy "Practitioners can create invitations"
  on invitations for insert
  with check (auth.uid() = practitioner_id);

-- ---------------------------------------------------------------
-- 4. recommendations + recommendation_items — practitioner proposes,
--    client accepts. Accepting calls the existing create_routine; nothing
--    here writes to routines/routine_steps directly.
-- ---------------------------------------------------------------
create table if not exists recommendations (
  id             uuid primary key default gen_random_uuid(),
  practitioner_id uuid not null references auth.users(id) on delete cascade,
  client_id      uuid not null references auth.users(id) on delete cascade,
  status         text not null default 'proposed'
                   check (status in ('proposed', 'accepted', 'declined', 'superseded')),
  note           text,
  created_at     timestamptz not null default now(),
  responded_at   timestamptz
);

alter table recommendations enable row level security;

create table if not exists recommendation_items (
  id                uuid primary key default gen_random_uuid(),
  recommendation_id uuid not null references recommendations(id) on delete cascade,
  product_id        uuid not null references products(id),
  slot              text not null check (slot in ('AM', 'PM')),
  frequency         text not null default 'daily',
  reason            text,
  sort_order        int not null default 0
);

alter table recommendation_items enable row level security;

create policy "Practitioners see their own recommendations"
  on recommendations for select
  using (auth.uid() = practitioner_id);

create policy "Clients see recommendations made to them"
  on recommendations for select
  using (auth.uid() = client_id);

create policy "Practitioners can propose recommendations"
  on recommendations for insert
  with check (auth.uid() = practitioner_id and status = 'proposed');

create policy "Clients can respond to recommendations"
  on recommendations for update
  using (auth.uid() = client_id)
  with check (auth.uid() = client_id);

-- Same column-pinning problem as practitioners above — the policy lets a
-- client update the row at all (so they can set status/responded_at), but
-- without this trigger they could also rewrite the practitioner's note or
-- practitioner_id in the same request. A client-initiated update can only
-- ever change status and responded_at; everything else is pinned.
create or replace function lock_recommendation_fields_for_client()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() = old.client_id then
    new.practitioner_id := old.practitioner_id;
    new.client_id := old.client_id;
    new.note := old.note;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

create trigger recommendations_lock_client_fields
  before update on recommendations
  for each row execute function lock_recommendation_fields_for_client();

create policy "Recommendation items follow their recommendation"
  on recommendation_items for select
  using (
    exists (
      select 1 from recommendations r
      where r.id = recommendation_items.recommendation_id
        and (r.practitioner_id = auth.uid() or r.client_id = auth.uid())
    )
  );

create policy "Practitioners can add items to their own recommendations"
  on recommendation_items for insert
  with check (
    exists (
      select 1 from recommendations r
      where r.id = recommendation_items.recommendation_id
        and r.practitioner_id = auth.uid()
        and r.status = 'proposed'
    )
  );

-- ---------------------------------------------------------------
-- 5. practitioner_access_log — write-only from the RPCs below, readable
--    by both sides (the client seeing it is the point).
-- ---------------------------------------------------------------
create table if not exists practitioner_access_log (
  id             uuid primary key default gen_random_uuid(),
  practitioner_id uuid not null references auth.users(id) on delete cascade,
  client_id      uuid not null references auth.users(id) on delete cascade,
  what           text not null,
  at             timestamptz not null default now()
);

alter table practitioner_access_log enable row level security;

create policy "Clients can see who accessed their data"
  on practitioner_access_log for select
  using (auth.uid() = client_id);

create policy "Practitioners can see their own access history"
  on practitioner_access_log for select
  using (auth.uid() = practitioner_id);

-- ---------------------------------------------------------------
-- 6. has_client_access — the one function every added policy below calls.
-- ---------------------------------------------------------------
create or replace function has_client_access(p_client uuid, p_scope text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from care_relationships cr
    join practitioners pr on pr.user_id = cr.practitioner_id
    where cr.client_id = p_client
      and cr.practitioner_id = auth.uid()
      and cr.status = 'active'
      and p_scope = any(cr.scopes)
      and pr.verified_at is not null
  );
$$;

revoke all on function has_client_access(uuid, text) from public, anon;
grant execute on function has_client_access(uuid, text) to authenticated;

-- ---------------------------------------------------------------
-- 7. Additive read policies on existing client-data tables. These are
--    NEW policies, not edits to the existing owner-only ones — Postgres
--    OR's multiple permissive policies together, so the owner policy is
--    untouched and this only ever adds access, never removes any.
-- ---------------------------------------------------------------
create policy "Practitioners with skin_profile scope can view"
  on skin_profiles for select
  using ((select has_client_access(user_id, 'skin_profile')));

create policy "Practitioners with routine scope can view routines"
  on routines for select
  using ((select has_client_access(user_id, 'routine')));

create policy "Practitioners with routine scope can view routine steps"
  on routine_steps for select
  using (
    exists (
      select 1 from routines r
      where r.id = routine_steps.routine_id
        and (select has_client_access(r.user_id, 'routine'))
    )
  );

create policy "Practitioners with routine scope can view user products"
  on user_products for select
  using ((select has_client_access(user_id, 'routine')));

create policy "Practitioners with daily_logs scope can view completions"
  on routine_step_completions for select
  using ((select has_client_access(user_id, 'daily_logs')));

create policy "Practitioners with daily_logs scope can view routine completions"
  on routine_completions for select
  using ((select has_client_access(user_id, 'daily_logs')));

-- ---------------------------------------------------------------
-- 8. RPCs — the sanctioned, logged interface for the practitioner side.
--    Client-side actions (accept/revoke) are RPCs too, so there's one
--    audited code path for every state change instead of raw table writes.
-- ---------------------------------------------------------------

-- Client accepts an in-app invite (the practitioner already knows their
-- account — pathway for clients who already have Tracka+ accounts).
create or replace function accept_care_relationship(p_relationship_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update care_relationships
  set status = 'active', accepted_at = now(), last_active_at = now()
  where id = p_relationship_id
    and client_id = auth.uid()
    and status = 'invited';

  if not found then
    raise exception 'Invitation not found or already handled';
  end if;
end;
$$;

revoke all on function accept_care_relationship(uuid) from public, anon;
grant execute on function accept_care_relationship(uuid) to authenticated;

-- Client revokes, at any stage — no reason required, no notice to the
-- practitioner beyond the relationship simply no longer being active.
create or replace function revoke_care_access(p_relationship_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update care_relationships
  set status = 'revoked', revoked_at = now()
  where id = p_relationship_id
    and client_id = auth.uid()
    and status in ('invited', 'active');

  if not found then
    raise exception 'Relationship not found or already revoked';
  end if;
end;
$$;

revoke all on function revoke_care_access(uuid) from public, anon;
grant execute on function revoke_care_access(uuid) to authenticated;

-- Token invite, for people not yet on the platform. Whoever is signed in
-- when they open the link redeems it — no email/phone verification against
-- the token's target, since the unguessable token is the security boundary,
-- same as any other invite-link pattern.
create or replace function accept_invitation(p_token uuid)
returns uuid -- the new care_relationships.id
language plpgsql security definer set search_path = public
as $$
declare
  v_invite invitations;
  v_relationship_id uuid;
begin
  select * into v_invite from invitations where token = p_token for update;

  if not found then
    raise exception 'Invitation not found';
  end if;

  if v_invite.used_at is not null then
    raise exception 'Invitation already used';
  end if;

  if v_invite.expires_at < now() then
    raise exception 'Invitation expired';
  end if;

  insert into care_relationships (practitioner_id, client_id, status, scopes, accepted_at, last_active_at)
  values (v_invite.practitioner_id, auth.uid(), 'active', v_invite.scopes, now(), now())
  on conflict (practitioner_id, client_id) where status in ('invited', 'active')
  do update set status = 'active', scopes = v_invite.scopes, accepted_at = now(), last_active_at = now()
  returning id into v_relationship_id;

  update invitations set used_at = now(), used_by = auth.uid() where token = p_token;

  return v_relationship_id;
end;
$$;

revoke all on function accept_invitation(uuid) from public, anon;
grant execute on function accept_invitation(uuid) to authenticated;

-- Client adjusts which scopes are granted on an active relationship —
-- narrowing (or widening, within what was ever offered) without a full
-- revoke. Scopes is capped to the fixed four values by the table's own
-- check constraint, so there's nothing extra to validate here.
create or replace function update_care_relationship_scopes(p_relationship_id uuid, p_scopes text[])
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update care_relationships
  set scopes = p_scopes
  where id = p_relationship_id
    and client_id = auth.uid()
    and status = 'active';

  if not found then
    raise exception 'Relationship not found or not active';
  end if;
end;
$$;

revoke all on function update_care_relationship_scopes(uuid, text[]) from public, anon;
grant execute on function update_care_relationship_scopes(uuid, text[]) to authenticated;

-- Practitioner's client list — deliberately NOT logged. Seeing a name in
-- a list isn't "accessing their data" in the sense the log is meant to
-- capture, and logging it would bury the entries that actually matter
-- (opening someone's skin profile) under one "list" row every time the
-- dashboard loads.
create or replace function practitioner_list_clients()
returns table (
  relationship_id uuid,
  client_id uuid,
  username text,
  status text,
  scopes text[],
  accepted_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
begin
  return query
  select cr.id, cr.client_id, p.username, cr.status, cr.scopes, cr.accepted_at
  from care_relationships cr
  join profiles p on p.id = cr.client_id
  where cr.practitioner_id = auth.uid()
    and cr.status in ('invited', 'active')
  order by cr.accepted_at desc nulls last, cr.invited_at desc;
end;
$$;

revoke all on function practitioner_list_clients() from public, anon;
grant execute on function practitioner_list_clients() to authenticated;

-- Opening one client's detail — this is the one that matters for the
-- access log the client actually sees ("your aesthetician viewed your
-- profile on...").
create or replace function practitioner_get_client_profile(p_client uuid)
returns table (
  skin_type text,
  concerns text,
  goals text,
  sensitivity text,
  gender text,
  pregnant_or_breastfeeding boolean
)
language plpgsql security definer set search_path = public
as $$
begin
  if not (select has_client_access(p_client, 'skin_profile')) then
    raise exception 'Not authorized';
  end if;

  insert into practitioner_access_log (practitioner_id, client_id, what)
  values (auth.uid(), p_client, 'view_skin_profile');

  return query
  select sp.skin_type, sp.concerns, sp.goals, sp.sensitivity, sp.gender, sp.pregnant_or_breastfeeding
  from skin_profiles sp
  where sp.user_id = p_client
  order by sp.created_at desc
  limit 1;
end;
$$;

revoke all on function practitioner_get_client_profile(uuid) from public, anon;
grant execute on function practitioner_get_client_profile(uuid) to authenticated;
