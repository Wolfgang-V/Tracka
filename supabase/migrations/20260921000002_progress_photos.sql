-- Progress photo journal: lets a user capture or upload skin photos over
-- time so they can compare their journey. Photo bytes live in a private
-- storage bucket (never public — these are personal photos); this table
-- holds one row per photo, referencing its storage path.
create table if not exists progress_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  path text not null,
  local_date date not null,
  note text,
  created_at timestamptz not null default now()
);

alter table progress_photos enable row level security;

drop policy if exists "Users manage their own progress photos" on progress_photos;

create policy "Users manage their own progress photos"
  on progress_photos
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('progress-photos', 'progress-photos', false)
on conflict (id) do nothing;

-- Objects are uploaded to `<user_id>/<timestamp>.<ext>`, so the first path
-- segment is the owning user's id — these policies key off that segment
-- rather than any table join.
drop policy if exists "Users read their own progress photo files" on storage.objects;
drop policy if exists "Users upload their own progress photo files" on storage.objects;
drop policy if exists "Users delete their own progress photo files" on storage.objects;

create policy "Users read their own progress photo files"
  on storage.objects
  for select
  using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users upload their own progress photo files"
  on storage.objects
  for insert
  with check (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users delete their own progress photo files"
  on storage.objects
  for delete
  using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = auth.uid()::text);
