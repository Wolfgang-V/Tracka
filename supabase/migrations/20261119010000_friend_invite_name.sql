-- Friend invites greet with the friend's name (reviewer's suggestion).
--
-- record_referral_scan returned the partner name, and every friend code
-- shares one partner row, so opening a friend's link showed "Welcome! You
-- were referred by Friend referrals." For a friend code it now returns:
--   partner: null        (so no app version shows "Friend referrals")
--   friend:  true
--   inviter: the owner's profiles.username, or null if they have none
-- Store and clinic codes are unchanged.
--
-- Only the username is ever returned — never the email-based fallback the
-- app uses for display, since this function is callable without signing
-- in. Anyone holding a friend's link learns that friend's username, which
-- is the point of the greeting; codes are random, so they can't be guessed.
--
-- Ship order: either way round is safe. Before the app update, friend links
-- simply show no greeting (partner is null); after it, "Deeyah invited you".

create or replace function public.record_referral_scan(p_code text, p_visitor uuid, p_user_agent text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_code_id uuid;
  v_partner text;
  v_owner uuid;
  v_inviter text;
begin
  if p_visitor is null then
    return jsonb_build_object('ok', false);
  end if;

  select rc.id, pt.name, rc.owner_user_id into v_code_id, v_partner, v_owner
  from referral_codes rc
  left join referral_partners pt on pt.id = rc.partner_id
  where rc.code = upper(trim(p_code))
    and rc.is_active
    and (pt.id is null or pt.is_active);

  if v_code_id is null then
    return jsonb_build_object('ok', false);
  end if;

  insert into referral_scans (code_id, visitor_id, user_agent)
  values (v_code_id, p_visitor, left(p_user_agent, 300))
  on conflict (code_id, visitor_id, scan_date) do nothing;

  if v_owner is not null then
    select left(nullif(trim(p.username), ''), 40) into v_inviter from profiles p where p.id = v_owner;
    return jsonb_build_object('ok', true, 'partner', null, 'friend', true, 'inviter', v_inviter);
  end if;

  return jsonb_build_object('ok', true, 'partner', v_partner);
end;
$function$;
