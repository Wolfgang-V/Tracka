create or replace function get_invitation_preview(p_token uuid)
returns table (
  display_name text,
  title text,
  bio text,
  scopes text[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used_at timestamptz;
  v_expires_at timestamptz;
  v_display_name text;
  v_title text;
  v_bio text;
  v_scopes text[];
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select i.used_at, i.expires_at, p.display_name, p.title, p.bio, i.scopes
  into v_used_at, v_expires_at, v_display_name, v_title, v_bio, v_scopes
  from invitations i
  join practitioners p on p.user_id = i.practitioner_id
  where i.token = p_token;

  if not found then
    raise exception 'Invitation not found';
  end if;

  if v_used_at is not null then
    raise exception 'Invitation already used';
  end if;

  if v_expires_at <= now() then
    raise exception 'Invitation expired';
  end if;

  return query select v_display_name, v_title, v_bio, v_scopes;
end;
$$;

revoke all on function get_invitation_preview(uuid) from public, anon;
grant execute on function get_invitation_preview(uuid) to authenticated;
