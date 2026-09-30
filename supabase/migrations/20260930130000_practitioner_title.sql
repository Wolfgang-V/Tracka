-- Lets a practitioner choose their own professional title (e.g.
-- "Esthetician", "Licensed Dermatologist", "Skincare Consultant") instead
-- of the app hardcoding a single term for every practitioner — free text,
-- not a fixed role/account-type picker, since app behavior doesn't branch
-- on it (same "one role, described freely" reasoning as dumping the
-- Esthetician/Vendor/Brand/Clinic account-type picker from the PDF).
alter table practitioners
  add column if not exists title text;

-- admin_list_pending_practitioners() return type gained a column — has to
-- be dropped first, same as any RETURNS TABLE change.
drop function if exists admin_list_pending_practitioners();

create function admin_list_pending_practitioners()
returns table (
  user_id uuid,
  email text,
  display_name text,
  title text,
  bio text,
  specialisms text[],
  instagram text,
  whatsapp text,
  created_at timestamptz
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
  select pr.user_id, u.email::text, pr.display_name, pr.title, pr.bio, pr.specialisms, pr.instagram, pr.whatsapp, pr.created_at
  from practitioners pr
  join auth.users u on u.id = pr.user_id
  where pr.verified_at is null
  order by pr.created_at asc;
end;
$$;

revoke all on function admin_list_pending_practitioners() from public, anon;
grant execute on function admin_list_pending_practitioners() to authenticated;
