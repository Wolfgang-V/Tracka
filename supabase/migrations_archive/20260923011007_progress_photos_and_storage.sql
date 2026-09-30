create table if not exists progress_photos (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  path       text not null,
  local_date date not null,
  note       text,
  created_at timestamptz not null default now()
);

-- The storage policies below trust the first folder segment to be the
-- user's id. Enforce the same rule on the row, so the table and the
-- bucket can't disagree about who owns a file.
alter table progress_photos
  add constraint progress_photos_path_owned
  check (path like (user_id::text || '/%'));

alter table progress_photos enable row level security;

drop policy if exists "Users manage their own progress photos" on progress_photos;

create policy "Users manage their own progress photos"
  on progress_photos for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('progress-photos', 'progress-photos', false)
on conflict (id) do nothing;

drop policy if exists "Users read their own progress photo files"   on storage.objects;
drop policy if exists "Users upload their own progress photo files" on storage.objects;
drop policy if exists "Users update their own progress photo files" on storage.objects;
drop policy if exists "Users delete their own progress photo files" on storage.objects;

create policy "Users read their own progress photo files"
  on storage.objects for select to authenticated
  using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users upload their own progress photo files"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- Needed for upsert: uploading over an existing path is an UPDATE.
create policy "Users update their own progress photo files"
  on storage.objects for update to authenticated
  using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users delete their own progress photo files"
  on storage.objects for delete to authenticated
  using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = auth.uid()::text);;
