alter table public.referral_partners
  drop constraint if exists referral_partners_kind_check;

alter table public.referral_partners
  add constraint referral_partners_kind_check
  check (kind in ('store', 'clinic', 'spa', 'aesthetician', 'brand', 'online', 'event', 'tracka'));