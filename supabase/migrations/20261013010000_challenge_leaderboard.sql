-- Challenge leaderboard — used to pick gift winners in the open, so users
-- and admin see the same ranking.
--
-- Ranking: most days completed; ties go to whoever reached that count
-- first (time their latest challenge day was recorded). One row per user —
-- their best active/completed attempt; people who left aren't ranked.
--
-- Usernames are shown by default with an opt-out. Opting out doesn't remove
-- someone from the ranking — they show as a private participant in their
-- real position, so nobody can wonder whether the list was edited. Admin
-- always sees who everyone is.

alter table challenge_participants
  add column if not exists hide_from_leaderboard boolean not null default false;


-- Internal: the full ranking, identities included. Not callable by users;
-- the two RPCs below decide what each audience gets to see.
create or replace function challenge_ranking(p_challenge_id uuid)
returns table (
  rank bigint,
  participant_id uuid,
  user_id uuid,
  username text,
  status text,
  days_completed integer,
  reached_at timestamptz,
  hidden boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with best as (
    select distinct on (cp.user_id) cp.*
    from challenge_participants cp
    where cp.challenge_id = p_challenge_id
      and cp.status in ('active', 'completed')
    order by cp.user_id, cp.days_completed desc, cp.joined_at desc
  ),
  scored as (
    select
      b.id, b.user_id, b.status, b.days_completed, b.hide_from_leaderboard,
      (select max(cd.created_at) from challenge_days cd where cd.participant_id = b.id) as reached_at
    from best b
  )
  select
    row_number() over (order by s.days_completed desc, s.reached_at asc nulls last, s.id),
    s.id,
    s.user_id,
    pr.username,
    s.status,
    s.days_completed,
    s.reached_at,
    s.hide_from_leaderboard
  from scored s
  left join profiles pr on pr.id = s.user_id
  order by 1;
$$;

revoke all on function challenge_ranking(uuid) from public, anon, authenticated;


create or replace function challenge_leaderboard(p_challenge_id uuid)
returns table (
  rank bigint,
  display_name text,
  status text,
  days_completed integer,
  is_me boolean,
  hidden boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if not exists (select 1 from challenges c where c.id = p_challenge_id and c.is_published) then
    raise exception 'Challenge not found';
  end if;

  return query
  select
    r.rank,
    case
      when r.hidden and r.user_id <> auth.uid() then null
      else coalesce(r.username, 'Tracka+ member')
    end,
    r.status,
    r.days_completed,
    r.user_id = auth.uid(),
    r.hidden
  from challenge_ranking(p_challenge_id) r;
end;
$$;

revoke all on function challenge_leaderboard(uuid) from public, anon;
grant execute on function challenge_leaderboard(uuid) to authenticated;


create or replace function set_leaderboard_visibility(p_challenge_id uuid, p_hidden boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update challenge_participants
  set hide_from_leaderboard = coalesce(p_hidden, false)
  where challenge_id = p_challenge_id
    and user_id = auth.uid();

  if not found then
    raise exception 'You are not in this challenge';
  end if;
end;
$$;

revoke all on function set_leaderboard_visibility(uuid, boolean) from public, anon;
grant execute on function set_leaderboard_visibility(uuid, boolean) to authenticated;


-- Admin participant list gains each person's leaderboard rank (null for
-- people who left, or a superseded attempt) and whether they've hidden.
-- RETURNS TABLE change → drop + create, grants repeated.
drop function if exists admin_challenge_participants(uuid);

create function admin_challenge_participants(p_challenge_id uuid)
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
  last_day date,
  rank bigint,
  hidden boolean
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
    (select max(cd.local_date) from challenge_days cd where cd.participant_id = cp.id),
    r.rank,
    cp.hide_from_leaderboard
  from challenge_participants cp
  join auth.users au on au.id = cp.user_id
  left join profiles pr on pr.id = cp.user_id
  left join challenge_ranking(p_challenge_id) r on r.participant_id = cp.id
  where cp.challenge_id = p_challenge_id
  order by r.rank asc nulls last, cp.joined_at desc;
end;
$$;

revoke all on function admin_challenge_participants(uuid) from public, anon;
grant execute on function admin_challenge_participants(uuid) to authenticated;
