-- Admin "Products" insights: which products and brands people actually use.
--
-- Every product someone adds is already stored (products + user_products);
-- this just aggregates it. The catalogue isn't deduplicated and people type
-- names their own way ("Cerave" / "CeraVe", trailing spaces, punctuation),
-- so products are grouped on a normalised key: lower-case, anything that
-- isn't a letter/number/%/+ collapsed to a single space, trimmed. Genuinely
-- different wordings ("Foaming Facial Cleanser" vs "Foaming Cleanser") stay
-- separate — merging those needs a human.
--
-- Per product/brand: people who ever saved it, people who have it now
-- (active), people with it in a current routine, and people who finished it.

create or replace function normalise_product_text(t text)
returns text
language sql
immutable
as $$
  select trim(regexp_replace(lower(coalesce(t, '')), '[^a-z0-9%+]+', ' ', 'g'));
$$;

create or replace function admin_product_insights()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not exists (
    select 1 from auth.users u
    where u.id = auth.uid() and u.email = 'trackaplusapp@gmail.com'
  ) then
    raise exception 'Not authorized';
  end if;

  with saved as (
    select
      up.id as user_product_id,
      up.user_id,
      up.is_active,
      up.finished_at,
      p.brand,
      p.name,
      p.category,
      p.image_url,
      normalise_product_text(p.brand) as brand_key,
      normalise_product_text(p.brand) || '|' || normalise_product_text(p.name) as product_key,
      exists (
        select 1
        from routine_steps rs
        join routines r on r.id = rs.routine_id
        where rs.user_product_id = up.id
          and rs.is_active and r.is_active
      ) as in_routine
    from user_products up
    join products p on p.id = up.product_id
  ),
  product_rows as (
    select
      product_key,
      mode() within group (order by trim(brand)) as brand,
      mode() within group (order by trim(name)) as name,
      mode() within group (order by category) as category,
      max(image_url) as image_url,
      count(distinct user_id) as users,
      count(distinct user_id) filter (where is_active) as active_users,
      count(distinct user_id) filter (where in_routine) as in_routine_users,
      count(distinct user_id) filter (where finished_at is not null) as finished_users
    from saved
    group by product_key
  ),
  brand_rows as (
    select
      brand_key,
      mode() within group (order by trim(brand)) as brand,
      count(distinct user_id) as users,
      count(distinct product_key) as products,
      count(distinct user_id) filter (where in_routine) as in_routine_users
    from saved
    where brand_key <> ''
    group by brand_key
  ),
  category_rows as (
    select
      coalesce(nullif(category, ''), 'other') as category,
      count(distinct user_id) as users,
      count(*) as saved
    from saved
    group by 1
  )
  select jsonb_build_object(
    'totals', jsonb_build_object(
      'users_with_products', (select count(distinct user_id) from saved),
      'saved', (select count(*) from saved),
      'distinct_products', (select count(*) from product_rows),
      'distinct_brands', (select count(*) from brand_rows),
      'finished', (select count(*) from saved where finished_at is not null)
    ),
    'products', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.users desc, x.in_routine_users desc, x.name)
      from (select * from product_rows order by users desc, in_routine_users desc limit 100) x
    ), '[]'::jsonb),
    'brands', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.users desc, x.brand)
      from (select * from brand_rows order by users desc limit 60) x
    ), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.users desc)
      from category_rows x
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function admin_product_insights() from public, anon;
grant execute on function admin_product_insights() to authenticated;
