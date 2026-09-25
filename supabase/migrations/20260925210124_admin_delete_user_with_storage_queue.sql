-- SQL can't remove the actual bytes from object storage — only the storage
-- API can. So record the paths before the rows disappear, and let a job with
-- the service role clear them. Without this, deleting a user orphans their
-- face photos in the bucket with nothing left to identify them.
create table if not exists storage_cleanup_queue (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text not null,
  path       text not null,
  reason     text not null,
  queued_at  timestamptz not null default now(),
  deleted_at timestamptz
);

alter table storage_cleanup_queue enable row level security;

create index if not exists storage_cleanup_queue_pending_idx
  on storage_cleanup_queue (queued_at) where deleted_at is null;

create or replace function admin_delete_user(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email  text;
  v_photos int;
begin
  if not exists (
    select 1 from auth.users u
    where u.id = auth.uid() and u.email = 'trackaplusapp@gmail.com'
  ) then
    raise exception 'Not authorized';
  end if;

  if target_id = auth.uid() then
    raise exception 'Cannot delete your own account';
  end if;

  select u.email::text into v_email from auth.users u where u.id = target_id;

  if v_email is null then
    raise exception 'No such user';
  end if;

  insert into storage_cleanup_queue (bucket_id, path, reason)
  select 'progress-photos', pp.path, 'user_deleted'
  from progress_photos pp
  where pp.user_id = target_id;

  get diagnostics v_photos = row_count;

  delete from progress_photos where user_id = target_id;

  insert into admin_audit_log (actor_id, action, target_id, details)
  values (auth.uid(), 'delete', target_id,
          jsonb_build_object('email', v_email, 'photos_queued', v_photos));

  delete from auth.users where id = target_id;
end;
$$;

revoke all on function admin_delete_user(uuid) from public;
grant execute on function admin_delete_user(uuid) to authenticated;;
