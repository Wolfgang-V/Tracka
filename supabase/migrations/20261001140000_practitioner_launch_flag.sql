-- Parks the practitioner feature behind a toggle so it can be launched
-- later without a code deploy. Auto-verify means any signed-up user can
-- currently become a practitioner and see other users' data in one call —
-- fine for the small internal test group that exists today, not fine to
-- leave open to all 109 live users before there's an actual launch moment.
--
-- Deliberately narrow: this only blocks *new* applicants
-- (submit_practitioner_application's INSERT path). Anyone who already has a
-- practitioners row — an existing tester, verified or pending or revoked —
-- keeps working exactly as before, including editing their own profile.
-- Nothing about care_relationships, recommendations, or invites is touched,
-- so existing test relationships are unaffected either way. Flip the flag
-- with: select admin_set_feature_flag('practitioners_launch', true);

create table if not exists feature_flags (
  key text primary key,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

insert into feature_flags (key, enabled)
values ('practitioners_launch', false)
on conflict (key) do nothing;

alter table feature_flags enable row level security;

drop policy if exists "Anyone can read feature flags" on feature_flags;
create policy "Anyone can read feature flags"
  on feature_flags for select
  using (true);

-- RLS only restricts rows, not table access — every other table got this
-- via the baseline's blanket grants, but this table is new. Read-only:
-- all writes go through admin_set_feature_flag.
grant select on table feature_flags to anon, authenticated;

create or replace function admin_set_feature_flag(flag_key text, enabled boolean)
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

  update feature_flags
  set enabled = admin_set_feature_flag.enabled, updated_at = now(), updated_by = auth.uid()
  where key = flag_key;

  if not found then
    raise exception 'Unknown feature flag: %', flag_key;
  end if;

  insert into admin_audit_log (actor_id, action, target_id, details)
  values (auth.uid(), 'set_feature_flag', auth.uid(), jsonb_build_object('key', flag_key, 'enabled', enabled));
end;
$$;

revoke all on function admin_set_feature_flag(text, boolean) from public, anon;
grant execute on function admin_set_feature_flag(text, boolean) to authenticated;

create or replace function submit_practitioner_application(
  p_display_name text,
  p_title text,
  p_bio text,
  p_specialisms text[],
  p_instagram text,
  p_whatsapp text
)
returns text -- 'verified' or 'pending'
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_launched boolean;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (select 1 from practitioners where user_id = v_user_id) then
    select enabled into v_launched from feature_flags where key = 'practitioners_launch';

    if coalesce(v_launched, false) is false then
      raise exception 'Practitioner applications aren''t open yet.';
    end if;
  end if;

  insert into practitioners (user_id, display_name, title, bio, specialisms, instagram, whatsapp, verified_at)
  values (v_user_id, p_display_name, p_title, p_bio, p_specialisms, p_instagram, p_whatsapp, now())
  on conflict (user_id) do update set
    display_name = excluded.display_name,
    title = excluded.title,
    bio = excluded.bio,
    specialisms = excluded.specialisms,
    instagram = excluded.instagram,
    whatsapp = excluded.whatsapp;

  return case when (select verified_at from practitioners where user_id = v_user_id) is not null
    then 'verified' else 'pending' end;
end;
$$;

revoke all on function submit_practitioner_application(text, text, text, text[], text, text) from public, anon;
grant execute on function submit_practitioner_application(text, text, text, text[], text, text) to authenticated;
