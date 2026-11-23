-- Ebun Derma challenge image: the product shot instead of the model photo.
--
-- The challenge page crops images to a wide strip across the middle; on
-- applying.jpg (shallow depth of field) that strip is the soft, blurry part.
-- tubes.jpg is the sharpest of the five and its middle is the logo + SPF 50.
--
-- Already applied live by hand on 2026-11-23 (one-row update); this file
-- keeps the repo in step. Safe to run again.

update challenges
set image_url = 'https://www.trackaplus.app/ads/ebun-derma/tubes.jpg'
where id = 'e8d0a5f1-3c2b-4d7e-9a61-2f5b8c4d0e01';
