-- Backfill products.source for past Open Beauty Facts picks. Until now the
-- add form never set source, so all 744 rows say 'manual' — including
-- products picked from the Open Beauty Facts suggestions.
--
-- The only trace left is the photo: the app only ever stores an
-- images.openbeautyfacts.org URL when the product came from an Open Beauty
-- Facts match. So this catches picks that had a photo, and misses picks
-- that had none (those stay 'manual'; there is no way to tell them apart).
--
-- Independent of the app release: the app change (marking new picks as
-- 'openbeautyfacts') works with or without this, and this only touches
-- existing rows. Safe to re-run.
--
-- Synced from live (applied by the reviewer as 20261118023643
-- backfill_products_source_openbeautyfacts).
--
-- Reviewer: premise verified in the app rather than assumed. products has
-- exactly two writers — App.jsx inserts {brand, name, category} and never
-- sets image_url, and AddProductScreen gates it:
--   image_url: productImageUrl.startsWith('https://images.openbeautyfacts.org/')
--              ? productImageUrl : null
-- so that host cannot arrive by any other path. No false positives.
--
-- Affects exactly 7 of 744 rows. Recorded here so the change can be undone:
--   180f03bd-4d8c-4919-8f0a-ab57bd96d8db
--   562adda5-ec25-40a3-9842-a333531291fd
--   83da4b50-e003-499e-8c32-4d2da60b0355
--   bdf2947c-7312-403f-8660-5173c8395b63
--   bebb2bcf-6dfd-42bc-913e-ab9b64862884
--   ce36b3ee-8f20-456c-91bc-0123f13c4775
--   d949e8cd-68c3-4646-b375-e6363f01fd4b
--
-- Caveat: products.source is only trustworthy from 2026-11-18 onward. The
-- 737 rows left 'manual' include an unknown number of photo-less Open Beauty
-- Facts picks, so don't read "where products come from" history off it.

update products
set source = 'openbeautyfacts'
where source = 'manual'
  and image_url like 'https://images.openbeautyfacts.org/%';
