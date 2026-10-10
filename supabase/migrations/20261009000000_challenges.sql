-- Challenges (first one: "30 Days of SPF").
--
-- A challenge never asks the user to tick anything new. Progress is derived
-- from the routine they already have: a trigger on routine_step_completions
-- records a challenge day whenever the qualifying step (for 'am_sunscreen':
-- a sunscreen-category product in an AM routine) is ticked, and removes it
-- again if that same-day tick is undone. Users can read their own progress
-- but never write it directly — joining/leaving go through RPCs, and day
-- rows only ever come from the trigger.
--
-- Leaving keeps the row (status = 'left', days_completed frozen) so admin
-- analytics can see who dropped off and how far they got. Rejoining after
-- leaving or completing creates a fresh participation row.

create table if not exists challenges (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  tagline text,
  description text,
  active_subtitle text,
  goal_text text,
  rule text not null check (rule in ('am_sunscreen')),
  duration_days integer not null check (duration_days between 1 and 365),
  image_url text,
  sponsor_name text,
  is_published boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists challenge_participants (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references challenges(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'completed', 'left')),
  start_date date not null,
  days_completed integer not null default 0,
  joined_at timestamptz not null default now(),
  completed_at timestamptz,
  left_at timestamptz
);

-- One live attempt per challenge per user; past (completed/left) attempts
-- are kept alongside it.
create unique index if not exists challenge_participants_one_active
  on challenge_participants (challenge_id, user_id) where status = 'active';

create index if not exists challenge_participants_user_idx
  on challenge_participants (user_id);

create table if not exists challenge_days (
  participant_id uuid not null references challenge_participants(id) on delete cascade,
  local_date date not null,
  created_at timestamptz not null default now(),
  primary key (participant_id, local_date)
);

alter table challenges enable row level security;
alter table challenge_participants enable row level security;
alter table challenge_days enable row level security;

create policy "Signed-in users can view published challenges"
  on challenges for select to authenticated
  using (is_published);

create policy "Users can view their own challenge participation"
  on challenge_participants for select to authenticated
  using (auth.uid() = user_id);

create policy "Users can view their own challenge days"
  on challenge_days for select to authenticated
  using (exists (
    select 1 from challenge_participants cp
    where cp.id = challenge_days.participant_id and cp.user_id = auth.uid()
  ));

revoke all on table challenges, challenge_participants, challenge_days from anon;
revoke insert, update, delete on table challenges, challenge_participants, challenge_days from authenticated;


-- Recomputes whether p_date counts for each of the user's active challenges,
-- then refreshes the cached count and flips to 'completed' at the target.
-- Idempotent: safe to call from the trigger on insert, update or delete.
create or replace function refresh_challenge_progress(p_user uuid, p_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
  v_done boolean;
  v_count integer;
begin
  for v in
    select cp.id, c.rule, c.duration_days
    from challenge_participants cp
    join challenges c on c.id = cp.challenge_id
    where cp.user_id = p_user
      and cp.status = 'active'
      and cp.start_date <= p_date
  loop
    v_done := false;

    if v.rule = 'am_sunscreen' then
      -- Deliberately doesn't require the step/routine to still be active:
      -- a routine rebuild later in the day deactivates the old steps, but
      -- the tick still happened.
      select exists (
        select 1
        from routine_step_completions comp
        join routine_steps rs on rs.id = comp.routine_step_id
        join routines r on r.id = rs.routine_id
        join user_products up on up.id = rs.user_product_id
        join products p on p.id = up.product_id
        where comp.user_id = p_user
          and comp.local_date = p_date
          and r.user_id = p_user
          and r.time_of_day = 'AM'
          and lower(p.category) = 'sunscreen'
      ) into v_done;
    end if;

    if v_done then
      insert into challenge_days (participant_id, local_date)
      values (v.id, p_date)
      on conflict do nothing;
    else
      delete from challenge_days
      where participant_id = v.id and local_date = p_date;
    end if;

    select count(*) into v_count from challenge_days where participant_id = v.id;

    update challenge_participants
    set days_completed = v_count,
        status = case when v_count >= v.duration_days then 'completed' else status end,
        completed_at = case when v_count >= v.duration_days then now() else completed_at end
    where id = v.id;
  end loop;
end;
$$;

revoke all on function refresh_challenge_progress(uuid, date) from public, anon, authenticated;


create or replace function challenge_progress_from_completion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := coalesce(new.user_id, old.user_id);
  v_date date := coalesce(new.local_date, old.local_date);
begin
  -- Cheap early-out: almost nobody ticking a step is in a challenge.
  if exists (
    select 1 from challenge_participants
    where user_id = v_user and status = 'active'
  ) then
    perform refresh_challenge_progress(v_user, v_date);
    if tg_op = 'UPDATE' and old.local_date is distinct from new.local_date then
      perform refresh_challenge_progress(v_user, old.local_date);
    end if;
  end if;

  return null;
end;
$$;

revoke all on function challenge_progress_from_completion() from public, anon, authenticated;

drop trigger if exists challenge_progress_on_completion on routine_step_completions;
create trigger challenge_progress_on_completion
  after insert or update or delete on routine_step_completions
  for each row execute function challenge_progress_from_completion();


-- Joins a challenge. p_local_date is the client's localDateString() (4am
-- cutoff) so day 1 lines up with the same date the Today screen uses.
-- Raises NO_SUNSCREEN_STEP when the user's active AM routine has no
-- sunscreen step, so the app can prompt them to add one.
create or replace function join_challenge(p_challenge_id uuid, p_local_date date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_challenge challenges%rowtype;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_id uuid;
begin
  if v_user is null then
    raise exception 'Not signed in';
  end if;

  select * into v_challenge from challenges where id = p_challenge_id and is_published;
  if not found then
    raise exception 'Challenge not found';
  end if;

  -- Same ±1 day timezone grace used elsewhere for client-sent local dates.
  if p_local_date is null or p_local_date < v_today - 1 or p_local_date > v_today + 1 then
    raise exception 'Invalid date';
  end if;

  if exists (
    select 1 from challenge_participants
    where challenge_id = p_challenge_id and user_id = v_user and status = 'active'
  ) then
    raise exception 'ALREADY_JOINED';
  end if;

  if v_challenge.rule = 'am_sunscreen' and not exists (
    select 1
    from routines r
    join routine_steps rs on rs.routine_id = r.id
    join user_products up on up.id = rs.user_product_id
    join products p on p.id = up.product_id
    where r.user_id = v_user
      and r.is_active
      and rs.is_active
      and r.time_of_day = 'AM'
      and lower(p.category) = 'sunscreen'
  ) then
    raise exception 'NO_SUNSCREEN_STEP';
  end if;

  insert into challenge_participants (challenge_id, user_id, start_date)
  values (p_challenge_id, v_user, p_local_date)
  returning id into v_id;

  -- Already ticked sunscreen this morning before joining? Count it.
  perform refresh_challenge_progress(v_user, p_local_date);

  return v_id;
end;
$$;

revoke all on function join_challenge(uuid, date) from public, anon;
grant execute on function join_challenge(uuid, date) to authenticated;


create or replace function leave_challenge(p_participant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update challenge_participants
  set status = 'left', left_at = now()
  where id = p_participant_id
    and user_id = auth.uid()
    and status = 'active';

  if not found then
    raise exception 'No active challenge to leave';
  end if;
end;
$$;

revoke all on function leave_challenge(uuid) from public, anon;
grant execute on function leave_challenge(uuid) to authenticated;


-- Admin analytics. "Left halfway" = left before reaching half the duration.
create or replace function admin_challenge_stats()
returns table (
  challenge_id uuid,
  title text,
  duration_days integer,
  is_published boolean,
  participants bigint,
  active_count bigint,
  completed_count bigint,
  left_count bigint,
  left_before_half bigint,
  avg_days_when_left numeric
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
    c.id,
    c.title,
    c.duration_days,
    c.is_published,
    count(distinct cp.user_id),
    count(cp.id) filter (where cp.status = 'active'),
    count(cp.id) filter (where cp.status = 'completed'),
    count(cp.id) filter (where cp.status = 'left'),
    count(cp.id) filter (where cp.status = 'left' and cp.days_completed * 2 < c.duration_days),
    round(avg(cp.days_completed) filter (where cp.status = 'left'), 1)
  from challenges c
  left join challenge_participants cp on cp.challenge_id = c.id
  group by c.id
  order by c.created_at;
end;
$$;

revoke all on function admin_challenge_stats() from public, anon;
grant execute on function admin_challenge_stats() to authenticated;


create or replace function admin_challenge_participants(p_challenge_id uuid)
returns table (
  participant_id uuid,
  user_id uuid,
  email text,
  username text,
  status text,
  days_completed integer,
  start_date date,
  joined_at timestamptz,
  completed_at timestamptz,
  left_at timestamptz,
  last_day date
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
    cp.id,
    cp.user_id,
    au.email::text,
    pr.username,
    cp.status,
    cp.days_completed,
    cp.start_date,
    cp.joined_at,
    cp.completed_at,
    cp.left_at,
    (select max(cd.local_date) from challenge_days cd where cd.participant_id = cp.id)
  from challenge_participants cp
  join auth.users au on au.id = cp.user_id
  left join profiles pr on pr.id = cp.user_id
  where cp.challenge_id = p_challenge_id
  order by cp.joined_at desc;
end;
$$;

revoke all on function admin_challenge_participants(uuid) from public, anon;
grant execute on function admin_challenge_participants(uuid) to authenticated;


insert into challenges (slug, title, tagline, description, active_subtitle, goal_text, rule, duration_days, is_published)
values (
  'spf-30',
  '30 Days of SPF',
  'Make sunscreen part of your everyday routine.',
  'Build a consistent sunscreen habit by using sunscreen as part of your morning skincare routine for 30 days.',
  'Your sunscreen habit starts here.',
  'Complete the sunscreen step in your morning routine.',
  'am_sunscreen',
  30,
  true
)
on conflict (slug) do nothing;
