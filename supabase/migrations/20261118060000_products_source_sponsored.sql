-- Products saved from a sponsored product page ("Add to My Products") are
-- marked source = 'sponsored', so product insights can tell brand-promoted
-- adds apart from the 744 organic rows. Once a row lands as 'manual' there
-- is no way to tell it apart later, so this has to be right from the start.
--
-- Ship order: this migration FIRST, then the app. The app sends
-- source = 'sponsored' for those saves, which the old check rejects.
-- (Widening a CHECK can't invalidate existing rows.)
--
-- Reviewer note: this tags the CATALOGUE row, which is only equivalent to
-- tagging the individual save while each products row serves exactly one
-- user — true today (max users on any one product: 1). If the catalogue is
-- ever deduplicated so two people share a row, the tag stops meaning "this
-- person added it from an ad" and should move to user_products instead.

alter table products drop constraint if exists products_source_check;
alter table products add constraint products_source_check
  check (source in ('manual', 'openbeautyfacts', 'sponsored'));
