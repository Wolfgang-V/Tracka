-- Refer a friend (Settings → Refer a friend).
--
-- Every person can get their own invite link: one row in referral_codes,
-- owned by them (owner_user_id) and grouped under a single "Friend
-- referrals" partner (kind 'friend'). Everything else is the existing
-- referral platform unchanged: the link is ?ref=CODE, record_referral_scan
-- logs the visit, claim_referral attributes the sign-up first-touch, and
-- the admin Referrals report shows friend invites as one partner row with
-- the same funnel (sign-ups → onboarded → logged → perfect day).
--
-- Codes are created lazily — only when someone opens Refer a friend — so
-- the admin code list only grows by people who actually invite.
--
-- Rewards: none yet (no subscriptions). When they launch, the reward list
-- is derivable from what's stored here: attributions on a friend code with
-- new_signup = true. Nothing needs backfilling then.
--
-- Ship order: this migration FIRST, then the app. The app calls
-- my_referral(), which doesn't exist before this. (Nothing else changes
-- behaviour: the claim_referral edit only adds a self-referral guard.)

-- 1. A partner kind for friend invites.
alter table referral_partners drop constraint if exists referral_partners_kind_check;
alter table referral_partners add constraint referral_partners_kind_check
  check (kind in ('store', 'clinic', 'spa', 'aesthetician', 'brand', 'online', 'event', 'tracka', 'friend'));

insert into referral_partners (name, kind, notes)
select 'Friend referrals', 'friend', 'Personal invite links from Settings → Refer a friend. One code per person.'
where not exists (select 1 from referral_partners where kind = 'friend');

-- 2. Who owns a friend code. Kept if the account goes (set null) so past
--    sign-ups still count in the report.
alter table referral_codes
  add column if not exists owner_user_id uuid references auth.users(id) on delete set null;
create unique index if not exists referral_codes_owner_idx
  on referral_codes (owner_user_id) where owner_user_id is not null;

-- 3. The caller's own code (made on first call) and how many friends have
--    joined through it. Only counts genuinely new accounts (new_signup).
create or replace function my_referral()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_code referral_codes%rowtype;
  v_partner uuid;
  v_new text;
  v_tries int := 0;
begin
  if v_user is null then
    raise exception 'Not signed in';
  end if;

  select * into v_code from referral_codes where owner_user_id = v_user;

  if not found then
    select id into v_partner from referral_partners where kind = 'friend' order by created_at limit 1;
    loop
      -- F- plus 6 characters with no look-alikes (no 0/O, 1/I/L).
      v_new := 'F-' || (
        select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '')
        from generate_series(1, 6)
      );
      begin
        insert into referral_codes (code, partner_id, label, owner_user_id, created_by)
        values (v_new, v_partner, 'Friend invite', v_user, v_user)
        returning * into v_code;
        exit;
      exception when unique_violation then
        -- Either the code clashed, or a second tap already made this
        -- person's code. Use theirs if it exists; otherwise try again.
        select * into v_code from referral_codes where owner_user_id = v_user;
        if found then
          exit;
        end if;
        v_tries := v_tries + 1;
        if v_tries >= 5 then
          raise;
        end if;
      end;
    end loop;
  end if;

  return jsonb_build_object(
    'code', v_code.code,
    'active', v_code.is_active,
    'friends_joined', (
      select count(*) from referral_attributions a
      where a.code_id = v_code.id and a.new_signup and a.user_id <> v_user
    ),
    'friends_onboarded', (
      select count(*) from referral_attributions a
      join profiles p on p.id = a.user_id
      where a.code_id = v_code.id and a.new_signup and a.user_id <> v_user
        and coalesce(p.onboarding_completed, false)
    )
  );
end;
$$;

revoke all on function my_referral() from public, anon;
grant execute on function my_referral() to authenticated;

-- 4. claim_referral, as live, plus one guard: opening your own invite link
--    never attributes you to yourself.
create or replace function public.claim_referral(p_visitor uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
  v_code uuid;
  v_first timestamptz;
  v_created timestamptz;
begin
  if v_user is null or p_visitor is null then
    return false;
  end if;

  select s.code_id, s.scanned_at into v_code, v_first
  from referral_scans s
  where s.visitor_id = p_visitor
  order by s.scanned_at asc
  limit 1;

  if v_code is null then
    return false;
  end if;

  if exists (select 1 from referral_codes where id = v_code and owner_user_id = v_user) then
    return false;
  end if;

  select u.created_at into v_created from auth.users u where u.id = v_user;

  insert into referral_attributions (user_id, code_id, visitor_id, first_scan_at, new_signup)
  values (v_user, v_code, p_visitor, v_first, coalesce(v_created >= v_first, false))
  on conflict (user_id) do nothing;

  return found;
end;
$function$;
