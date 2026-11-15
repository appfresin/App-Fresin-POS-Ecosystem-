-- Kasirin! Supabase full integration migration
-- Jalankan di Supabase SQL Editor setelah schema awal sudah dibuat.
-- File ini idempotent: aman dijalankan ulang, dan tidak menghapus data transaksi lama.
--
-- Catatan keamanan:
-- Aplikasi saat ini dipakai lokal 1 outlet dan sebelumnya memilih RLS OFF.
-- Bagian akhir file ini tetap mematikan RLS untuk mode anon/local sesuai keputusan itu.

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Kolom integrasi yang kurang di tabel inti
-- ---------------------------------------------------------------------------

alter table if exists public.store_settings
  add column if not exists database_mode text not null default 'local',
  add column if not exists sync_endpoint text,
  add column if not exists auto_backup boolean not null default true,
  add column if not exists receipt_store_name text,
  add column if not exists receipt_footer text;

alter table if exists public.categories
  add column if not exists local_id text,
  add column if not exists sort_order integer not null default 0,
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.addons
  add column if not exists local_id text,
  add column if not exists cost numeric(14,2) not null default 0,
  add column if not exists category text,
  add column if not exists sort_order integer not null default 0,
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.products
  add column if not exists local_id text,
  add column if not exists image_name text,
  add column if not exists unit text,
  add column if not exists station text,
  add column if not exists prep_minutes integer not null default 0,
  add column if not exists kitchen_note text,
  add column if not exists channel_pos boolean not null default true,
  add column if not exists channel_self_order boolean not null default false,
  add column if not exists channel_delivery boolean not null default true,
  add column if not exists allowed_addon_ids jsonb not null default '[]'::jsonb,
  add column if not exists sold_out_variants jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.orders
  add column if not exists local_id text,
  add column if not exists table_label text,
  add column if not exists customer_phone text,
  add column if not exists discount_mode text not null default 'amount',
  add column if not exists discount_rate numeric(8,4) not null default 0,
  add column if not exists prepared_items jsonb not null default '{}'::jsonb,
  add column if not exists cancel_reason text,
  add column if not exists cancelled_by_name text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists label_printed_at timestamptz,
  add column if not exists sync_state text not null default 'synced',
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.order_items
  add column if not exists local_id text,
  add column if not exists product_local_id text,
  add column if not exists variant_key text,
  add column if not exists variant_name text,
  add column if not exists discount_mode text not null default 'amount',
  add column if not exists discount_rate numeric(8,4) not null default 0,
  add column if not exists ready boolean not null default false,
  add column if not exists ready_at timestamptz;

alter table if exists public.order_item_addons
  add column if not exists local_id text,
  add column if not exists addon_local_id text,
  add column if not exists cost numeric(14,2) not null default 0;

alter table if exists public.payments
  add column if not exists payment_breakdown jsonb not null default '{}'::jsonb,
  add column if not exists provider_ref text,
  add column if not exists status text not null default 'paid',
  add column if not exists note text;

alter table if exists public.stock_movements
  add column if not exists product_local_id text,
  add column if not exists variant_key text,
  add column if not exists variant_label text,
  add column if not exists movement_type text not null default 'adjustment',
  add column if not exists balance_after numeric(14,2),
  add column if not exists note text;

-- ---------------------------------------------------------------------------
-- 2. Tabel baru untuk fitur yang sudah ada di aplikasi
-- ---------------------------------------------------------------------------

create table if not exists public.legacy_product_sales_imports (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  period_start date,
  period_end date,
  row_count integer not null default 0,
  imported_at timestamptz not null default now(),
  raw_meta jsonb not null default '{}'::jsonb
);

create table if not exists public.legacy_product_sales (
  id uuid primary key default gen_random_uuid(),
  import_id uuid references public.legacy_product_sales_imports(id) on delete set null,
  import_key text,
  code text,
  name text not null,
  transaction_count integer not null default 0,
  qty numeric(14,3) not null default 0,
  revenue numeric(14,2) not null default 0,
  profit numeric(14,2) not null default 0,
  period_start date,
  period_end date,
  source text not null default 'Import Penjualan Barang Lama',
  file_name text,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.sync_queue (
  id uuid primary key default gen_random_uuid(),
  client_queue_id text,
  entity_type text not null,
  entity_key text not null,
  operation text not null default 'upsert',
  payload jsonb not null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  last_error text,
  next_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_cancellations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete cascade,
  order_number text,
  reason text not null,
  source text not null default 'app',
  cancelled_by_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.product_availability_events (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete set null,
  product_local_id text,
  product_name text not null,
  variant_key text,
  variant_label text,
  available boolean not null,
  reason text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3. Index dan unique key untuk sinkronisasi local -> Supabase
-- ---------------------------------------------------------------------------

create unique index if not exists categories_local_id_key
  on public.categories(local_id)
  where local_id is not null;

create unique index if not exists addons_local_id_key
  on public.addons(local_id)
  where local_id is not null;

create unique index if not exists products_local_id_key
  on public.products(local_id)
  where local_id is not null;

create unique index if not exists orders_local_id_key
  on public.orders(local_id)
  where local_id is not null;

create unique index if not exists order_items_local_id_key
  on public.order_items(local_id)
  where local_id is not null;

create unique index if not exists order_item_addons_local_id_key
  on public.order_item_addons(local_id)
  where local_id is not null;

create unique index if not exists legacy_product_sales_import_key_key
  on public.legacy_product_sales(import_key)
  where import_key is not null;

create unique index if not exists sync_queue_client_queue_id_key
  on public.sync_queue(client_queue_id)
  where client_queue_id is not null;

create index if not exists orders_created_at_idx on public.orders(created_at);
create index if not exists orders_status_idx on public.orders(status);
create index if not exists orders_payment_status_idx on public.orders(payment_status);
create index if not exists order_items_order_id_idx on public.order_items(order_id);
create index if not exists legacy_sales_created_at_idx on public.legacy_sales(created_at);
create index if not exists legacy_product_sales_period_idx on public.legacy_product_sales(period_start, period_end);
create index if not exists legacy_product_sales_name_idx on public.legacy_product_sales(name);
create index if not exists sync_queue_status_idx on public.sync_queue(status, next_attempt_at);

-- ---------------------------------------------------------------------------
-- 4. Trigger updated_at ringan
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_store_settings_updated_at on public.store_settings;
create trigger trg_store_settings_updated_at
before update on public.store_settings
for each row execute function public.set_updated_at();

drop trigger if exists trg_categories_updated_at on public.categories;
create trigger trg_categories_updated_at
before update on public.categories
for each row execute function public.set_updated_at();

drop trigger if exists trg_addons_updated_at on public.addons;
create trigger trg_addons_updated_at
before update on public.addons
for each row execute function public.set_updated_at();

drop trigger if exists trg_products_updated_at on public.products;
create trigger trg_products_updated_at
before update on public.products
for each row execute function public.set_updated_at();

drop trigger if exists trg_orders_updated_at on public.orders;
create trigger trg_orders_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

drop trigger if exists trg_sync_queue_updated_at on public.sync_queue;
create trigger trg_sync_queue_updated_at
before update on public.sync_queue
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. View laporan agregat
--    View ini sengaja dibuat agar frontend tidak perlu menarik puluhan ribu row.
-- ---------------------------------------------------------------------------

drop view if exists public.report_profit_daily cascade;
drop view if exists public.report_profit_monthly cascade;
drop view if exists public.report_profit_yearly cascade;
drop view if exists public.report_payment_summary_daily cascade;
drop view if exists public.report_order_type_summary_daily cascade;
drop view if exists public.report_visitor_summary_daily cascade;
drop view if exists public.report_product_sales_daily cascade;
drop view if exists public.report_product_sales_records cascade;
drop view if exists public.report_sales_records cascade;

create view public.report_sales_records as
select
  o.id,
  o.order_number as number,
  o.created_at,
  o.source,
  o.type::text as order_type,
  o.customer_name,
  o.service_info,
  o.status::text as order_status,
  o.payment_status::text as payment_status,
  coalesce(p.method, 'Belum dipilih') as payment_method,
  o.subtotal,
  o.discount,
  o.discount_mode,
  o.grand_total as total,
  o.profit_total as profit,
  o.cancel_reason,
  false as imported
from public.orders o
left join lateral (
  select method
  from public.payments p
  where p.order_id = o.id
  order by p.paid_at desc
  limit 1
) p on true

union all

select
  l.id,
  l.legacy_number as number,
  l.created_at,
  'Import Kasir Lama' as source,
  l.order_type,
  l.customer_name,
  l.customer_name as service_info,
  'Selesai' as order_status,
  l.payment_status,
  l.payment_method,
  l.subtotal,
  l.discount,
  'amount' as discount_mode,
  l.total,
  l.profit,
  null::text as cancel_reason,
  true as imported
from public.legacy_sales l;

create view public.report_profit_yearly as
select
  extract(year from created_at)::int as year,
  count(*)::int as transaction_count,
  coalesce(sum(total), 0)::numeric(14,2) as revenue,
  coalesce(sum(profit), 0)::numeric(14,2) as profit
from public.report_sales_records
where payment_status = 'Lunas'
  and order_status <> 'Dibatalkan'
group by extract(year from created_at);

create view public.report_profit_monthly as
select
  extract(year from created_at)::int as year,
  extract(month from created_at)::int as month,
  count(*)::int as transaction_count,
  coalesce(sum(total), 0)::numeric(14,2) as revenue,
  coalesce(sum(profit), 0)::numeric(14,2) as profit
from public.report_sales_records
where payment_status = 'Lunas'
  and order_status <> 'Dibatalkan'
group by extract(year from created_at), extract(month from created_at);

create view public.report_profit_daily as
select
  created_at::date as date,
  extract(year from created_at)::int as year,
  extract(month from created_at)::int as month,
  extract(day from created_at)::int as day,
  count(*)::int as transaction_count,
  coalesce(sum(total), 0)::numeric(14,2) as revenue,
  coalesce(sum(profit), 0)::numeric(14,2) as profit
from public.report_sales_records
where payment_status = 'Lunas'
  and order_status <> 'Dibatalkan'
group by created_at::date, extract(year from created_at), extract(month from created_at), extract(day from created_at);

create view public.report_payment_summary_daily as
select
  created_at::date as date,
  payment_method,
  count(*)::int as transaction_count,
  coalesce(sum(total), 0)::numeric(14,2) as revenue
from public.report_sales_records
where payment_status = 'Lunas'
  and order_status <> 'Dibatalkan'
group by created_at::date, payment_method;

create view public.report_order_type_summary_daily as
select
  created_at::date as date,
  order_type,
  count(*)::int as order_count,
  coalesce(sum(total), 0)::numeric(14,2) as revenue
from public.report_sales_records
where order_status <> 'Dibatalkan'
group by created_at::date, order_type;

create view public.report_visitor_summary_daily as
select
  created_at::date as date,
  count(*)::int as order_count,
  count(*) filter (where order_type = 'Dine In')::int as dine_in_count,
  count(*) filter (where order_type = 'Take Away')::int as take_away_count,
  count(*) filter (where order_type = 'Delivery')::int as delivery_count,
  coalesce(sum(total), 0)::numeric(14,2) as revenue,
  coalesce(avg(nullif(total, 0)), 0)::numeric(14,2) as average_order
from public.report_sales_records
where order_status <> 'Dibatalkan'
group by created_at::date;

create view public.report_product_sales_records as
select
  oi.id,
  o.created_at,
  o.order_number,
  'Aplikasi'::text as source,
  false as imported,
  'product'::text as item_type,
  coalesce(oi.product_id::text, oi.product_local_id, oi.sku, oi.product_name) as item_key,
  oi.sku as code,
  oi.product_name as name,
  oi.qty::numeric(14,3) as qty,
  1::int as transaction_count,
  ((oi.price * oi.qty) - oi.discount)::numeric(14,2) as revenue,
  (oi.cost * oi.qty)::numeric(14,2) as cost,
  (((oi.price - oi.cost) * oi.qty) - oi.discount)::numeric(14,2) as profit,
  o.type::text as order_type,
  coalesce(p.method, 'Belum dipilih') as payment_method,
  o.payment_status::text as payment_status
from public.order_items oi
join public.orders o on o.id = oi.order_id
left join lateral (
  select method
  from public.payments p
  where p.order_id = o.id
  order by p.paid_at desc
  limit 1
) p on true
where o.status <> 'Dibatalkan'

union all

select
  oia.id,
  o.created_at,
  o.order_number,
  'Aplikasi'::text as source,
  false as imported,
  'addon'::text as item_type,
  coalesce(oia.addon_id::text, oia.addon_local_id, oia.addon_name) as item_key,
  null::text as code,
  oia.addon_name as name,
  oia.qty::numeric(14,3) as qty,
  1::int as transaction_count,
  (oia.price * oia.qty)::numeric(14,2) as revenue,
  (oia.cost * oia.qty)::numeric(14,2) as cost,
  ((oia.price - oia.cost) * oia.qty)::numeric(14,2) as profit,
  o.type::text as order_type,
  coalesce(p.method, 'Belum dipilih') as payment_method,
  o.payment_status::text as payment_status
from public.order_item_addons oia
join public.order_items oi on oi.id = oia.order_item_id
join public.orders o on o.id = oi.order_id
left join lateral (
  select method
  from public.payments p
  where p.order_id = o.id
  order by p.paid_at desc
  limit 1
) p on true
where o.status <> 'Dibatalkan'

union all

select
  lps.id,
  coalesce(lps.period_end, lps.period_start, current_date)::timestamptz as created_at,
  null::text as order_number,
  lps.source,
  true as imported,
  'legacy_product'::text as item_type,
  coalesce(lps.code, lps.name) as item_key,
  lps.code,
  lps.name,
  lps.qty,
  lps.transaction_count,
  lps.revenue,
  (lps.revenue - lps.profit)::numeric(14,2) as cost,
  lps.profit,
  'Import'::text as order_type,
  'Import'::text as payment_method,
  'Lunas'::text as payment_status
from public.legacy_product_sales lps;

create view public.report_product_sales_daily as
select
  created_at::date as date,
  item_type,
  item_key,
  code,
  name,
  coalesce(sum(qty), 0)::numeric(14,3) as qty,
  coalesce(sum(transaction_count), 0)::int as transaction_count,
  coalesce(sum(revenue), 0)::numeric(14,2) as revenue,
  coalesce(sum(cost), 0)::numeric(14,2) as cost,
  coalesce(sum(profit), 0)::numeric(14,2) as profit
from public.report_product_sales_records
where payment_status = 'Lunas'
group by created_at::date, item_type, item_key, code, name;

-- ---------------------------------------------------------------------------
-- 6. Mode lokal tanpa login: RLS off dan grant anon
-- ---------------------------------------------------------------------------

alter table if exists public.store_settings disable row level security;
alter table if exists public.staff_profiles disable row level security;
alter table if exists public.categories disable row level security;
alter table if exists public.addons disable row level security;
alter table if exists public.products disable row level security;
alter table if exists public.product_addons disable row level security;
alter table if exists public.cash_sessions disable row level security;
alter table if exists public.orders disable row level security;
alter table if exists public.order_items disable row level security;
alter table if exists public.order_item_addons disable row level security;
alter table if exists public.payments disable row level security;
alter table if exists public.stock_movements disable row level security;
alter table if exists public.legacy_sales_imports disable row level security;
alter table if exists public.legacy_sales disable row level security;
alter table if exists public.legacy_product_sales_imports disable row level security;
alter table if exists public.legacy_product_sales disable row level security;
alter table if exists public.sync_queue disable row level security;
alter table if exists public.order_cancellations disable row level security;
alter table if exists public.product_availability_events disable row level security;
alter table if exists public.audit_logs disable row level security;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant select on all tables in schema public to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

commit;
