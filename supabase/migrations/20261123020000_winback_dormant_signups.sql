-- Applied live by the reviewer 2026-11-23 as 20261123072115
-- winback_dormant_signups. Pulled into the repo verbatim (statements from
-- supabase_migrations.schema_migrations) so a later migration doesn't
-- silently revert it.
--
-- Win-back for dormant sign-ups who never finished setting up.
--
-- Who: confirmed accounts, not onboarded, confirmed more than 14 days ago
-- (so no overlap with the welcome email), who got at least as far as the
-- skin profile. Two groups, because they stopped in different places and
-- need different copy:
--
--   'has_products'   — saved products but never built a routine. 45 people
--                      with 118 products stranded in the app. The strong
--                      one: name their products, link to the routine builder.
--   'needs_products' — finished the skin profile, never added a product.
--                      52 people. Link straight to add-product.
--
-- The 9 who stopped before the skin profile are deliberately excluded:
-- barely signed up, most likely to report it as spam, nothing to reference.
--
-- This is a service email, not marketing: it tells someone their own account
-- has something unfinished in it, the way an abandoned basket does. That is
-- why it does not require marketing_opt_in — which nobody has given, because
-- nobody has been asked. It must still honour unsubscribe, hence part 1.
--
-- No cron on purpose. A one-time send is called by hand in small batches so
-- bounce and complaint rates can be checked between them.

-- 1. Unsubscribe --------------------------------------------------------
-- One suppression flag, honoured by every email the app sends from now on.
-- The token is per person and unguessable, so the unsubscribe link needs no
-- login — which matters, since someone who wants out will not sign in first.
alter table profiles
  add column if not exists email_suppressed boolean not null default false,
  add column if not exists email_suppressed_at timestamptz,
  add column if not exists unsubscribe_token uuid not null default gen_random_uuid();

create unique index if not exists profiles_unsubscribe_token_idx
  on profiles (unsubscribe_token);

-- Callable signed-out, by token only. Returns true if it suppressed (or had
-- already suppressed) that person, false for an unknown token. Reveals no
-- email address or profile data either way.
create or replace function unsubscribe_email(p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_token is null then
    return false;
  end if;

  update profiles
  set email_suppressed = true,
      email_suppressed_at = coalesce(email_suppressed_at, now()),
      marketing_opt_in = false
  where unsubscribe_token = p_token
  returning id into v_id;

  return v_id is not null;
end;
$$;

revoke all on function unsubscribe_email(uuid) from public;
grant execute on function unsubscribe_email(uuid) to anon, authenticated;

-- 2. The welcome email must honour suppression too ----------------------
create or replace function due_welcome_emails(p_limit int default 25)
returns table (user_id uuid, email text, first_name text, username text)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, u.email::text, p.first_name, p.username
  from auth.users u
  left join profiles p on p.id = u.id
  left join welcome_email_log l on l.user_id = u.id
  where u.email_confirmed_at is not null
    and u.email_confirmed_at > now() - interval '14 days'
    and u.email is not null
    and u.deleted_at is null
    and (u.banned_until is null or u.banned_until < now())
    and coalesce(p.email_suppressed, false) = false
    and (l.user_id is null or (l.status = 'failed' and l.attempts < 3))
  order by u.email_confirmed_at
  limit greatest(1, least(p_limit, 100));
$$;
revoke all on function due_welcome_emails(int) from public, anon, authenticated;
grant execute on function due_welcome_emails(int) to service_role;

-- 3. Win-back log and queue ---------------------------------------------
create table if not exists winback_email_log (
  user_id uuid primary key references auth.users(id) on delete cascade,
  variant text not null check (variant in ('has_products', 'needs_products')),
  status text not null check (status in ('sent', 'failed')),
  attempts int not null default 1,
  last_error text,
  updated_at timestamptz not null default now()
);
alter table winback_email_log enable row level security;
revoke all on winback_email_log from anon, authenticated;

create or replace function due_winback_emails(p_limit int default 20)
returns table (
  user_id uuid,
  email text,
  first_name text,
  username text,
  unsubscribe_token uuid,
  variant text,
  product_count int,
  product_names text[]
)
language sql
stable
security definer
set search_path = public
as $$
  with candidate as (
    select u.id, u.email::text as email, p.first_name, p.username,
           p.unsubscribe_token,
           (select count(*) from user_products up where up.user_id = u.id) as product_count
    from auth.users u
    join profiles p on p.id = u.id
    left join winback_email_log l on l.user_id = u.id
    where u.email_confirmed_at is not null
      and u.email_confirmed_at < now() - interval '14 days'
      and u.email is not null
      and u.deleted_at is null
      and (u.banned_until is null or u.banned_until < now())
      and coalesce(p.onboarding_completed, false) = false
      and coalesce(p.email_suppressed, false) = false
      -- got at least as far as the skin profile
      and exists (select 1 from skin_profiles s where s.user_id = u.id)
      -- anyone with a routine already finished the part this email asks for
      and not exists (select 1 from routines r where r.user_id = u.id)
      and (l.user_id is null or (l.status = 'failed' and l.attempts < 3))
  )
  select c.id, c.email, c.first_name, c.username, c.unsubscribe_token,
         case when c.product_count > 0 then 'has_products' else 'needs_products' end,
         c.product_count::int,
         (select array_agg(x.label order by x.label)
            from (select trim(coalesce(pr.brand,'') || ' ' || coalesce(pr.name,'')) as label
                  from user_products up join products pr on pr.id = up.product_id
                  where up.user_id = c.id
                  limit 5) x)
  from candidate c
  -- warmest first: the people who typed in products and stopped one step short
  order by c.product_count desc, c.id
  limit greatest(1, least(p_limit, 50));
$$;
revoke all on function due_winback_emails(int) from public, anon, authenticated;
grant execute on function due_winback_emails(int) to service_role;

create or replace function log_winback_email(p_user_id uuid, p_variant text, p_status text, p_error text default null)
returns void
language sql
security definer
set search_path = public
as $$
  insert into winback_email_log (user_id, variant, status, last_error)
  values (p_user_id, p_variant, p_status, p_error)
  on conflict (user_id) do update
    set status = excluded.status,
        variant = excluded.variant,
        attempts = winback_email_log.attempts + 1,
        last_error = excluded.last_error,
        updated_at = now();
$$;
revoke all on function log_winback_email(uuid, text, text, text) from public, anon, authenticated;
grant execute on function log_winback_email(uuid, text, text, text) to service_role;
