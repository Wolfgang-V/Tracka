-- Products become browsable: each has its own page with a personal photo,
-- an expiry countdown, and "Mark as finished" which moves it to Empties.
--
-- - finished_at: set when someone finishes a product (is_active goes false
--   too, so everything that reads active products is unaffected). Removing
--   a product added by mistake still just sets is_active = false — so
--   Empties is exactly "finished", never "deleted by accident".
-- - photo_path: a per-person photo in a private bucket. Not on the shared
--   products catalogue — everyone can read that and nobody can edit it.
-- - Photo files are queued for deletion whenever they stop being
--   referenced (photo replaced/removed, product row deleted, or the whole
--   account deleted via the existing user_products cascade), and the
--   existing storage-cleanup function removes them.

alter table user_products
  add column if not exists finished_at timestamptz,
  add column if not exists photo_path text;

alter table user_products
  drop constraint if exists user_products_photo_path_owned;
alter table user_products
  add constraint user_products_photo_path_owned
    check (photo_path is null or photo_path like (user_id::text || '/%'));


insert into storage.buckets (id, name, public)
values ('product-photos', 'product-photos', false)
on conflict (id) do nothing;

drop policy if exists "Users read their own product photo files"   on storage.objects;
drop policy if exists "Users upload their own product photo files" on storage.objects;
drop policy if exists "Users update their own product photo files" on storage.objects;
drop policy if exists "Users delete their own product photo files" on storage.objects;

create policy "Users read their own product photo files"
  on storage.objects for select to authenticated
  using (bucket_id = 'product-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users upload their own product photo files"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'product-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users update their own product photo files"
  on storage.objects for update to authenticated
  using (bucket_id = 'product-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'product-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users delete their own product photo files"
  on storage.objects for delete to authenticated
  using (bucket_id = 'product-photos' and (storage.foldername(name))[1] = auth.uid()::text);


create or replace function queue_replaced_product_photo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.photo_path is not null then
      insert into storage_cleanup_queue (bucket_id, path, reason)
      values ('product-photos', old.photo_path, 'product_deleted');
    end if;
    return old;
  end if;

  if old.photo_path is not null and old.photo_path is distinct from new.photo_path then
    insert into storage_cleanup_queue (bucket_id, path, reason)
    values ('product-photos', old.photo_path, 'photo_replaced');
  end if;
  return new;
end;
$$;

revoke all on function queue_replaced_product_photo() from public, anon, authenticated;

drop trigger if exists queue_product_photo_cleanup on user_products;
create trigger queue_product_photo_cleanup
  after update of photo_path or delete on user_products
  for each row execute function queue_replaced_product_photo();
