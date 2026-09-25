-- 1. Brands available in Nigeria, used for the brand picker
create table if not exists brands (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  aliases    text[] not null default '{}',
  created_at timestamptz not null default now()
);

create unique index if not exists brands_name_lower_key on brands (lower(name));

alter table brands enable row level security;

create policy "Signed-in users can read brands"
  on brands for select to authenticated using (true);

insert into brands (name, aliases) values
  ('Bolden', '{}'), ('Uncover', '{}'), ('Sufte Skin', '{}'), ('25 Pskynn', '{}'),
  ('Acne Beauty', '{}'), ('House of Coco', '{}'), ('Msmetics', '{}'), ('Skinscience', '{}'),
  ('Ebunderma', '{}'), ('Skin by Zaron', '{Zaron}'), ('Soibi Botanicals', '{Soibi}'),
  ('Soapy Suds', '{}'), ('Mai Skin', '{}'), ('Arami', '{}'), ('Isi Naturals', '{}'),
  ('Vaseline', '{}'), ('Topicals', '{}'), ('Nivea', '{}'), ('Eucerin', '{}'),
  ('Mesoestetic', '{}'), ('Abib', '{}'), ('Acwell', '{}'), ('Anua', '{}'),
  ('Axis-Y', '{"Axis Y"}'), ('Bioderma', '{}'), ('Bioré', '{Biore}'), ('Cosrx', '{}'),
  ('Bondi Sands', '{}'), ('Dang', '{}'), ('Dove', '{}'),
  ('Dr Teal''s', '{"Dr Teals","Dr. Teal''s"}'), ('Dr. Althea', '{"Dr Althea"}'),
  ('E45', '{}'), ('EOS', '{}'), ('Ezanic', '{}'), ('Face Facts', '{}'), ('Frudia', '{}'),
  ('Garnier', '{}'), ('La Roche-Posay', '{"La Roche Posay",LRP}'), ('CeraVe', '{}'),
  ('Good Molecules', '{}'), ('Hada Labo', '{}'), ('I''m From', '{"Im From"}'),
  ('Illiyoon', '{}'), ('Isispharma', '{}'), ('Isntree', '{}'), ('Innisfree', '{}'),
  ('Jumiso', '{}'), ('Kosé', '{Kose}'), ('Klairs', '{}'),
  ('L''Oréal', '{Loreal,"L''Oreal","L Oreal"}'), ('Medicube', '{}'), ('Medic 5.5', '{}'),
  ('Mixsoon', '{}'), ('Missha', '{}'), ('Nineless', '{}'), ('Numbuzin', '{}'),
  ('Olay', '{}'), ('Paula''s Choice', '{"Paulas Choice"}'), ('Purito', '{}'),
  ('Haruharu Wonder', '{"Haru Haru Wonder"}'), ('Pyunkang Yul', '{}'), ('Rejuva', '{}'),
  ('Replenix', '{}'), ('Tiam', '{}'), ('Round Lab', '{}'), ('Revox', '{}'),
  ('Seoul 1988', '{}'), ('Sachi Skin', '{}'), ('Simple', '{}'),
  ('Skin1004', '{"Skin 1004"}'), ('Some By Mi', '{Somebymi}'), ('Soonjung', '{}'),
  ('St. Ives', '{"St Ives"}'), ('Skin Aqua', '{}'), ('Timeless', '{}'), ('Tocobo', '{}'),
  ('Tonymoly', '{"Tony Moly"}'), ('Topicrem', '{}'), ('Touch', '{}'), ('Tree Hut', '{}'),
  ('Tirtir', '{}'), ('Torriden', '{}'), ('The Ordinary', '{Ordinary}'),
  ('Urban Skin Rx', '{}'), ('VT Cosmetics', '{VT}'), ('Sesderma', '{}'), ('Naturium', '{}'),
  ('Avène', '{Avene}'), ('Cetaphil', '{}'), ('Uriage', '{}'), ('SkinCeuticals', '{}'),
  ('PanOxyl', '{}'), ('Obagi', '{}'), ('Beauty of Joseon', '{}'),
  ('The Inkey List', '{"Inkey List"}'), ('Estée Lauder', '{"Estee Lauder"}'),
  ('Clinique', '{}'), ('Differin', '{}'), ('Kiehl''s', '{Kiehls}')
on conflict do nothing;

-- 2. Products learn where they came from and what's in them
alter table products
  add column if not exists barcode     text,
  add column if not exists ingredients text,
  add column if not exists image_url   text,
  add column if not exists source      text not null default 'manual',
  add column if not exists pao_hint    integer,
  add column if not exists brand_id    uuid references brands(id) on delete set null;

alter table products
  add constraint products_source_check
  check (source in ('manual', 'openbeautyfacts'));

alter table products
  add constraint products_pao_hint_check
  check (pao_hint is null or pao_hint between 1 and 60);

-- Plain unique (not partial): Postgres treats NULLs as distinct,
-- so manual products without barcodes never collide.
alter table products
  add constraint products_barcode_key unique (barcode);

-- 3. Link existing products to their brand where the name matches
update products p
set brand_id = b.id
from brands b
where p.brand_id is null
  and (
    lower(trim(p.brand)) = lower(b.name)
    or lower(trim(p.brand)) = any (select lower(a) from unnest(b.aliases) a)
  );;
