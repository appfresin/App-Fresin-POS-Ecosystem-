-- Kasirin Fresin POS - Full Supabase Migration Once
-- Target project: https://pjkotqianxecaawqompo.supabase.co
-- Generated from existing repo SQL files.
-- Run once in Supabase SQL Editor for the NEW project.
--
-- Notes:
-- 1. Do not paste service_role keys into SQL Editor or frontend files.
-- 2. This bundle keeps the app-compatible local/anon mode used by this project.
-- 3. It is designed to be idempotent where the source migrations are idempotent.
-- 4. If SQL Editor stops, read the last SECTION marker to know which source file failed.


-- ============================================================================
-- SECTION: docs\supabase_schema.sql
-- ============================================================================

-- Kasirin! Supabase schema - single outlet database
-- Satu Supabase project/database dipakai untuk satu outlet.
-- Jalankan di Supabase SQL Editor untuk membuat struktur database outlet.

create extension if not exists pgcrypto;

do $$
begin
  create type public.order_status as enum (
    'Pesanan Baru',
    'Dikonfirmasi',
    'Sedang Disiapkan',
    'Siap Diambil',
    'Selesai',
    'Dibatalkan'
  );
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.payment_status as enum ('Belum dibayar', 'Lunas', 'Refund', 'Batal');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.order_type as enum ('Dine In', 'Take Away', 'Delivery', 'Import');
exception when duplicate_object then null;
end $$;

create table if not exists public.store_settings (
  id uuid primary key default gen_random_uuid(),
  store_name text not null default 'Kasirin!',
  store_address text,
  store_phone text,
  receipt_footer text,
  receipt_width text not null default '58mm',
  receipt_show_table boolean not null default true,
  receipt_show_qr boolean not null default false,
  timezone text not null default 'Asia/Jakarta',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.staff_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null default 'admin',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.addons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price numeric(14,2) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories(id) on delete set null,
  name text not null,
  sku text unique,
  description text,
  price numeric(14,2) not null default 0,
  cost numeric(14,2) not null default 0,
  stock numeric(14,2) not null default 0,
  min_stock numeric(14,2) not null default 0,
  unit text not null default 'item',
  track_stock boolean not null default true,
  active boolean not null default true,
  sold_out boolean not null default false,
  prep_minutes integer not null default 5,
  station text not null default 'Dapur',
  channel_pos boolean not null default true,
  channel_self_order boolean not null default false,
  channel_delivery boolean not null default true,
  variant_mode text not null default 'off',
  variant_group text,
  variant_required boolean not null default false,
  variant_group2 text,
  variant_required2 boolean not null default false,
  variant_options jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.product_addons (
  product_id uuid not null references public.products(id) on delete cascade,
  addon_id uuid not null references public.addons(id) on delete cascade,
  primary key (product_id, addon_id)
);

create table if not exists public.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  opened_by uuid references public.staff_profiles(id) on delete set null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  opening_balance numeric(14,2) not null default 0,
  closing_balance numeric(14,2),
  note text,
  status text not null default 'open'
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  cash_session_id uuid references public.cash_sessions(id) on delete set null,
  order_number text not null unique,
  source text not null default 'Kasir',
  type public.order_type not null default 'Dine In',
  customer_name text not null default 'Walk-in',
  service_info text not null default '-',
  note text,
  status public.order_status not null default 'Pesanan Baru',
  payment_status public.payment_status not null default 'Belum dibayar',
  subtotal numeric(14,2) not null default 0,
  discount numeric(14,2) not null default 0,
  service_fee numeric(14,2) not null default 0,
  delivery_fee numeric(14,2) not null default 0,
  tax_amount numeric(14,2) not null default 0,
  grand_total numeric(14,2) not null default 0,
  profit_total numeric(14,2) not null default 0,
  print_receipt boolean not null default false,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  prepared_at timestamptz,
  prepared_items jsonb not null default '{}'::jsonb,
  notification_categories text[] not null default '{}'::text[],
  ready_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  sku text,
  qty numeric(14,2) not null default 1,
  price numeric(14,2) not null default 0,
  cost numeric(14,2) not null default 0,
  discount numeric(14,2) not null default 0,
  variant_label text,
  variant_data jsonb not null default '{}'::jsonb,
  note text
);

create table if not exists public.order_item_addons (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  addon_id uuid references public.addons(id) on delete set null,
  addon_name text not null,
  qty numeric(14,2) not null default 1,
  price numeric(14,2) not null default 0
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  method text not null,
  amount numeric(14,2) not null default 0,
  received_amount numeric(14,2) not null default 0,
  change_amount numeric(14,2) not null default 0,
  payment_breakdown jsonb not null default '{}'::jsonb,
  paid_at timestamptz not null default now()
);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  qty numeric(14,2) not null,
  reason text not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.staff_profiles(id) on delete set null
);

create table if not exists public.legacy_sales_imports (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  row_count integer not null default 0,
  imported_at timestamptz not null default now(),
  imported_by uuid references public.staff_profiles(id) on delete set null
);

create table if not exists public.legacy_sales (
  id uuid primary key default gen_random_uuid(),
  import_id uuid references public.legacy_sales_imports(id) on delete set null,
  legacy_number text not null unique,
  created_at timestamptz not null,
  customer_name text,
  cashier_name text,
  order_type text not null default 'Import',
  payment_method text not null default 'Cash dan Piutang',
  payment_status text not null default 'Lunas',
  subtotal numeric(14,2) not null default 0,
  discount numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  profit numeric(14,2) not null default 0,
  raw_data jsonb not null default '{}'::jsonb
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.staff_profiles(id) on delete set null,
  action text not null,
  detail text,
  created_at timestamptz not null default now()
);

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
  o.payment_status::text as payment_status,
  coalesce(p.method, 'Belum dipilih') as payment_method,
  o.subtotal,
  o.discount,
  o.grand_total as total,
  o.profit_total as profit,
  false as imported
from public.orders o
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
  l.id,
  l.legacy_number as number,
  l.created_at,
  'Import Kasir Lama' as source,
  l.order_type,
  coalesce(l.customer_name, '-') as customer_name,
  l.payment_status,
  l.payment_method,
  l.subtotal,
  l.discount,
  l.total,
  l.profit,
  true as imported
from public.legacy_sales l;

create index if not exists idx_products_category on public.products(category_id);
create index if not exists idx_products_active on public.products(active, sold_out);
create index if not exists idx_orders_created on public.orders(created_at desc);
create index if not exists idx_orders_status on public.orders(status, payment_status);
create index if not exists idx_order_items_order on public.order_items(order_id);
create index if not exists idx_payments_order on public.payments(order_id);
create index if not exists idx_legacy_sales_created on public.legacy_sales(created_at desc);
create index if not exists idx_stock_movements_created on public.stock_movements(created_at desc);

alter table public.store_settings enable row level security;
alter table public.staff_profiles enable row level security;
alter table public.categories enable row level security;
alter table public.addons enable row level security;
alter table public.products enable row level security;
alter table public.product_addons enable row level security;
alter table public.cash_sessions enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_item_addons enable row level security;
alter table public.payments enable row level security;
alter table public.stock_movements enable row level security;
alter table public.legacy_sales_imports enable row level security;
alter table public.legacy_sales enable row level security;
alter table public.audit_logs enable row level security;

-- Database ini hanya untuk satu outlet.
-- Selama user sudah login, user boleh mengakses data outlet ini.
-- Jika nanti perlu role lebih ketat, policy bisa dipersempit berdasarkan staff_profiles.role.

drop policy if exists authenticated_store_settings on public.store_settings;
create policy authenticated_store_settings on public.store_settings
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists authenticated_staff_profiles on public.staff_profiles;
create policy authenticated_staff_profiles on public.staff_profiles
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists authenticated_categories on public.categories;
create policy authenticated_categories on public.categories
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists authenticated_addons on public.addons;
create policy authenticated_addons on public.addons
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists authenticated_products on public.products;
create policy authenticated_products on public.products
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists authenticated_product_addons on public.product_addons;
create policy authenticated_product_addons on public.product_addons
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists authenticated_cash_sessions on public.cash_sessions;
create policy authenticated_cash_sessions on public.cash_sessions
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists authenticated_orders on public.orders;
create policy authenticated_orders on public.orders
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists authenticated_order_items on public.order_items;
create policy authenticated_order_items on public.order_items
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists authenticated_order_item_addons on public.order_item_addons;
create policy authenticated_order_item_addons on public.order_item_addons
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists authenticated_payments on public.payments;
create policy authenticated_payments on public.payments
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists authenticated_stock_movements on public.stock_movements;
create policy authenticated_stock_movements on public.stock_movements
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists authenticated_legacy_sales_imports on public.legacy_sales_imports;
create policy authenticated_legacy_sales_imports on public.legacy_sales_imports
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists authenticated_legacy_sales on public.legacy_sales;
create policy authenticated_legacy_sales on public.legacy_sales
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists authenticated_audit_logs on public.audit_logs;
create policy authenticated_audit_logs on public.audit_logs
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');



-- ============================================================================
-- SECTION: docs\supabase_full_integration_migration.sql
-- ============================================================================

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



-- ============================================================================
-- SECTION: docs\central_dashboard_schema.sql
-- ============================================================================

-- Kasirin! central dashboard schema - future phase
-- Database ini terpisah dari database kasir outlet.
-- Tugasnya membaca/menyimpan ringkasan dari banyak outlet, bukan menggantikan database outlet.

create extension if not exists pgcrypto;

create table if not exists public.outlet_registry (
  id uuid primary key default gen_random_uuid(),
  outlet_code text not null unique,
  outlet_name text not null,
  city text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.daily_sales_summary (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlet_registry(id) on delete cascade,
  sales_date date not null,
  transaction_count integer not null default 0,
  gross_sales numeric(14,2) not null default 0,
  discount_total numeric(14,2) not null default 0,
  net_sales numeric(14,2) not null default 0,
  profit_total numeric(14,2) not null default 0,
  unpaid_total numeric(14,2) not null default 0,
  synced_at timestamptz not null default now(),
  unique (outlet_id, sales_date)
);

create table if not exists public.monthly_sales_summary (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlet_registry(id) on delete cascade,
  sales_month text not null,
  transaction_count integer not null default 0,
  gross_sales numeric(14,2) not null default 0,
  discount_total numeric(14,2) not null default 0,
  net_sales numeric(14,2) not null default 0,
  profit_total numeric(14,2) not null default 0,
  unpaid_total numeric(14,2) not null default 0,
  synced_at timestamptz not null default now(),
  unique (outlet_id, sales_month)
);

create table if not exists public.payment_method_summary (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlet_registry(id) on delete cascade,
  sales_date date not null,
  payment_method text not null,
  transaction_count integer not null default 0,
  total_amount numeric(14,2) not null default 0,
  unique (outlet_id, sales_date, payment_method)
);

create table if not exists public.order_type_summary (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlet_registry(id) on delete cascade,
  sales_date date not null,
  order_type text not null,
  transaction_count integer not null default 0,
  total_amount numeric(14,2) not null default 0,
  unique (outlet_id, sales_date, order_type)
);

create table if not exists public.top_product_summary (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlet_registry(id) on delete cascade,
  sales_date date not null,
  product_name text not null,
  qty numeric(14,2) not null default 0,
  total_amount numeric(14,2) not null default 0,
  unique (outlet_id, sales_date, product_name)
);

create table if not exists public.stock_alert_summary (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlet_registry(id) on delete cascade,
  product_name text not null,
  stock numeric(14,2) not null default 0,
  min_stock numeric(14,2) not null default 0,
  alert_type text not null,
  synced_at timestamptz not null default now(),
  unique (outlet_id, product_name)
);

create index if not exists idx_daily_summary_date on public.daily_sales_summary(sales_date desc);
create index if not exists idx_monthly_summary_month on public.monthly_sales_summary(sales_month desc);
create index if not exists idx_payment_summary_date on public.payment_method_summary(sales_date desc);
create index if not exists idx_order_type_summary_date on public.order_type_summary(sales_date desc);
create index if not exists idx_top_product_summary_date on public.top_product_summary(sales_date desc);



-- ============================================================================
-- SECTION: docs\self_order_settings_sync.sql
-- ============================================================================

-- Proses 1: jadikan setting Self Order sebagai data bersama antar device.
-- Jalankan sekali di Supabase SQL Editor.

alter table if exists public.store_settings
  add column if not exists self_order_settings jsonb not null default '{}'::jsonb;

insert into public.store_settings (
  store_name,
  receipt_store_name,
  self_order_settings
)
select
  'Kasirin!',
  'Kasirin!',
  '{}'::jsonb
where not exists (select 1 from public.store_settings);



-- ============================================================================
-- SECTION: docs\addon_sold_out_foundation.sql
-- ============================================================================

alter table public.addons
  add column if not exists sold_out boolean not null default false;

create index if not exists addons_sold_out_idx
  on public.addons (sold_out);



-- ============================================================================
-- SECTION: docs\stock_inventory_foundation.sql
-- ============================================================================

-- Stock inventory foundation for Kasirin POS.
-- Run this once in Supabase SQL Editor.

alter table public.products
  add column if not exists stock_opname boolean not null default false,
  add column if not exists stock_opname_checked_at timestamptz,
  add column if not exists stock_opname_checked_by text;

create index if not exists products_stock_opname_idx
  on public.products (stock_opname)
  where stock_opname = true;

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete set null,
  local_product_id text,
  sku text,
  name text not null,
  category_name text,
  unit text not null default 'item',
  expected_qty numeric not null default 0,
  minimum_qty numeric not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists inventory_items_product_id_key
  on public.inventory_items(product_id)
  where product_id is not null;

create index if not exists inventory_items_active_idx
  on public.inventory_items(active, name);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid references public.inventory_items(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  movement_type text not null check (movement_type in ('in', 'out', 'adjustment', 'audit')),
  qty numeric not null,
  qty_before numeric,
  qty_after numeric,
  reason text,
  reference_type text,
  reference_id text,
  actor text,
  created_at timestamptz not null default now()
);

create index if not exists inventory_movements_created_at_idx
  on public.inventory_movements(created_at desc);

create index if not exists inventory_movements_item_idx
  on public.inventory_movements(inventory_item_id, created_at desc);

create table if not exists public.stock_audits (
  id uuid primary key default gen_random_uuid(),
  audit_number text not null unique,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'cancelled')),
  checked_count integer not null default 0,
  adjusted_count integer not null default 0,
  actor text,
  note text,
  created_at timestamptz not null default now(),
  submitted_at timestamptz
);

create table if not exists public.stock_audit_items (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.stock_audits(id) on delete cascade,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  product_id uuid references public.products(id) on delete set null,
  expected_qty numeric not null default 0,
  actual_qty numeric,
  difference_qty numeric generated always as (coalesce(actual_qty, expected_qty) - expected_qty) stored,
  checked boolean not null default false,
  checked_at timestamptz,
  checked_by text,
  note text
);

create index if not exists stock_audit_items_audit_idx
  on public.stock_audit_items(audit_id);

comment on column public.products.stock_opname is 'Marks product as part of periodic stock opname/audit list.';
comment on table public.inventory_items is 'Canonical inventory/raw material list for stock monitoring.';
comment on table public.inventory_movements is 'Append-only stock in/out/adjustment log.';
comment on table public.stock_audits is 'Stock opname audit session header.';
comment on table public.stock_audit_items is 'Per-item stock opname counts and differences.';



-- ============================================================================
-- SECTION: docs\fcm_push_notifications.sql
-- ============================================================================

-- Native FCM push notification foundation for Kasirin APK.
-- Run this in Supabase SQL editor before deploying the Edge Functions.

create extension if not exists pgcrypto;
create extension if not exists pg_net;

create table if not exists public.device_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  fcm_token text not null unique,
  platform text not null default 'android',
  scope_key text not null default 'default',
  target text not null default 'all' check (target in ('all', 'kasir', 'dapur')),
  device_name text not null default 'Kasirin Android',
  app_version text not null default '',
  kitchen_categories text[] not null default '{}'::text[],
  is_active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.device_push_tokens
  add column if not exists kitchen_categories text[] not null default '{}'::text[];

alter table public.orders
  add column if not exists notification_categories text[] not null default '{}'::text[];

drop function if exists public.kasirin_order_notification_status(uuid);
create function public.kasirin_order_notification_status(p_order_id uuid)
returns table(status text, notification_categories text[])
language sql
stable
security definer
set search_path = public
as $$
  select orders.status::text, coalesce(orders.notification_categories, '{}'::text[])
  from public.orders
  where orders.id = p_order_id
  limit 1;
$$;

revoke all on function public.kasirin_order_notification_status(uuid) from public;
grant execute on function public.kasirin_order_notification_status(uuid) to anon, authenticated;

create index if not exists idx_device_push_tokens_active_target
  on public.device_push_tokens (scope_key, is_active, target);

create table if not exists public.push_notification_logs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid null,
  order_number text not null default '',
  event_type text not null default 'new_order',
  target text not null default 'all',
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  error text not null default '',
  created_at timestamptz not null default now()
);

alter table public.device_push_tokens enable row level security;
alter table public.push_notification_logs enable row level security;

drop policy if exists "device_push_tokens_owner_read" on public.device_push_tokens;
create policy "device_push_tokens_owner_read"
  on public.device_push_tokens
  for select
  to authenticated
  using (auth.uid() = user_id);

-- No client read/write policy is created for push_notification_logs.
-- Edge Functions use the service role key and bypass RLS for operational logs.

create or replace function public.kasirin_notify_order_push()
returns trigger
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  internal_secret text;
  event_type text;
  request_id bigint;
begin
  if tg_op = 'INSERT' then
    event_type := 'new_order';
  elsif tg_op = 'UPDATE' then
    if coalesce(new.grand_total, 0) <= coalesce(old.grand_total, 0)
      and coalesce(new.subtotal, 0) <= coalesce(old.subtotal, 0) then
      return new;
    end if;
    if coalesce(new.payment_status::text, '') <> coalesce(old.payment_status::text, '')
      and coalesce(new.grand_total, 0) = coalesce(old.grand_total, 0)
      and coalesce(new.subtotal, 0) = coalesce(old.subtotal, 0) then
      return new;
    end if;
    event_type := 'additional_order';
  else
    return new;
  end if;

  if coalesce(new.status::text, '') in ('Dibatalkan', 'Selesai') then
    return new;
  end if;

  select decrypted_secret
    into internal_secret
  from vault.decrypted_secrets
  where name = 'kasirin_push_internal_secret'
  limit 1;

  if nullif(internal_secret, '') is null then
    raise warning 'kasirin_push_internal_secret is not configured';
    return new;
  end if;

  select net.http_post(
    url := 'https://pjkotqianxecaawqompo.supabase.co/functions/v1/notify-new-order',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-kasirin-push-secret', internal_secret
    ),
    body := jsonb_build_object(
      'internal', true,
      'eventType', event_type,
      'orderId', new.id,
      'orderNumber', coalesce(new.order_number, ''),
      'source', coalesce(new.source, ''),
      'table', coalesce(nullif(new.table_label, ''), nullif(new.service_info, ''), ''),
      'customer', coalesce(new.customer_name, ''),
      'scopeKey', 'outlet-utama',
      'target', 'all',
      'tone', 'alert',
      'orderCategories', coalesce(new.notification_categories, '{}'::text[])
    ),
    timeout_milliseconds := 15000
  ) into request_id;

  return new;
exception
  when others then
    raise warning 'kasirin_notify_order_push failed: %', sqlerrm;
    return new;
end;
$$;

drop trigger if exists trg_kasirin_notify_order_push on public.orders;
create trigger trg_kasirin_notify_order_push
  after insert or update on public.orders
  for each row
  execute function public.kasirin_notify_order_push();

notify pgrst, 'reload schema';



-- ============================================================================
-- SECTION: docs\report_profit_summary_views.sql
-- ============================================================================

-- Fast report views for Kasirin!
-- Jalankan file ini di Supabase SQL Editor.
--
-- Tujuan:
-- 1. Frontend membaca agregat kecil, bukan menarik puluhan ribu transaksi mentah.
-- 2. Data historis legacy_sales dan transaksi baru orders tampil sebagai satu laporan.
-- 3. Laporan transaksi menghitung order Lunas:
--    - Kasir/POS langsung masuk laporan setelah dibayar.
--    - Self Order masuk laporan setelah selesai diproses.
--
-- Aman dijalankan ulang. Script ini hanya mengganti view laporan, tidak menghapus data.

begin;

drop view if exists public.report_profit_daily cascade;
drop view if exists public.report_profit_monthly cascade;
drop view if exists public.report_profit_yearly cascade;
drop view if exists public.report_payment_summary_daily cascade;
drop view if exists public.report_order_type_summary_daily cascade;
drop view if exists public.report_visitor_summary_daily cascade;
drop view if exists public.report_sales_records cascade;

create or replace view public.report_sales_records as
select
  o.id,
  o.order_number as number,
  o.created_at,
  coalesce(p.paid_at, o.created_at) as paid_at,
  o.source,
  o.type::text as order_type,
  coalesce(o.customer_name, '-') as customer_name,
  coalesce(o.service_info, '-') as service_info,
  o.status::text as order_status,
  o.payment_status::text as payment_status,
  coalesce(p.method, 'Belum dipilih') as payment_method,
  coalesce(o.subtotal, 0)::numeric(14,2) as subtotal,
  coalesce(o.discount, 0)::numeric(14,2) as discount,
  coalesce(to_jsonb(o)->>'discount_mode', 'amount') as discount_mode,
  coalesce(o.grand_total, 0)::numeric(14,2) as total,
  coalesce(o.profit_total, 0)::numeric(14,2) as profit,
  coalesce(to_jsonb(o)->>'cancel_reason', '') as cancel_reason,
  false as imported
from public.orders o
left join lateral (
  select method, paid_at
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
  l.created_at as paid_at,
  'Import Kasir Lama' as source,
  l.order_type,
  coalesce(l.customer_name, '-') as customer_name,
  coalesce(l.customer_name, '-') as service_info,
  'Selesai' as order_status,
  coalesce(l.payment_status, 'Lunas') as payment_status,
  coalesce(l.payment_method, 'Cash dan Piutang') as payment_method,
  coalesce(l.subtotal, 0)::numeric(14,2) as subtotal,
  coalesce(l.discount, 0)::numeric(14,2) as discount,
  'amount' as discount_mode,
  coalesce(l.total, 0)::numeric(14,2) as total,
  coalesce(l.profit, 0)::numeric(14,2) as profit,
  '' as cancel_reason,
  true as imported
from public.legacy_sales l;

create or replace view public.report_profit_yearly as
select
  extract(year from paid_at)::int as year,
  count(*)::int as transaction_count,
  coalesce(sum(total), 0)::numeric(14,2) as total,
  coalesce(sum(total), 0)::numeric(14,2) as revenue,
  coalesce(sum(profit), 0)::numeric(14,2) as profit,
  coalesce(sum(total - profit), 0)::numeric(14,2) as estimated_cost
from public.report_sales_records
where payment_status = 'Lunas'
  and order_status <> 'Dibatalkan'
  and (
    order_status = 'Selesai'
    or lower(coalesce(source, '')) like '%kasir%'
    or lower(coalesce(source, '')) like '%pos%'
  )
group by extract(year from paid_at)::int;

create or replace view public.report_profit_monthly as
select
  extract(year from paid_at)::int as year,
  extract(month from paid_at)::int as month,
  count(*)::int as transaction_count,
  coalesce(sum(total), 0)::numeric(14,2) as total,
  coalesce(sum(total), 0)::numeric(14,2) as revenue,
  coalesce(sum(profit), 0)::numeric(14,2) as profit,
  coalesce(sum(total - profit), 0)::numeric(14,2) as estimated_cost
from public.report_sales_records
where payment_status = 'Lunas'
  and order_status <> 'Dibatalkan'
  and (
    order_status = 'Selesai'
    or lower(coalesce(source, '')) like '%kasir%'
    or lower(coalesce(source, '')) like '%pos%'
  )
group by
  extract(year from paid_at)::int,
  extract(month from paid_at)::int;

create or replace view public.report_profit_daily as
select
  extract(year from paid_at)::int as year,
  extract(month from paid_at)::int as month,
  extract(day from paid_at)::int as day,
  paid_at::date as sales_date,
  paid_at::date as date,
  count(*)::int as transaction_count,
  coalesce(sum(total), 0)::numeric(14,2) as total,
  coalesce(sum(total), 0)::numeric(14,2) as revenue,
  coalesce(sum(profit), 0)::numeric(14,2) as profit,
  coalesce(sum(total - profit), 0)::numeric(14,2) as estimated_cost
from public.report_sales_records
where payment_status = 'Lunas'
  and order_status <> 'Dibatalkan'
  and (
    order_status = 'Selesai'
    or lower(coalesce(source, '')) like '%kasir%'
    or lower(coalesce(source, '')) like '%pos%'
  )
group by
  extract(year from paid_at)::int,
  extract(month from paid_at)::int,
  extract(day from paid_at)::int,
  paid_at::date;

create or replace view public.report_payment_summary_daily as
select
  paid_at::date as date,
  payment_method,
  count(*)::int as transaction_count,
  coalesce(sum(total), 0)::numeric(14,2) as revenue
from public.report_sales_records
where payment_status = 'Lunas'
  and order_status <> 'Dibatalkan'
  and (
    order_status = 'Selesai'
    or lower(coalesce(source, '')) like '%kasir%'
    or lower(coalesce(source, '')) like '%pos%'
  )
group by paid_at::date, payment_method;

create or replace view public.report_order_type_summary_daily as
select
  paid_at::date as date,
  order_type,
  count(*)::int as order_count,
  coalesce(sum(total), 0)::numeric(14,2) as revenue
from public.report_sales_records
where order_status <> 'Dibatalkan'
group by paid_at::date, order_type;

create or replace view public.report_visitor_summary_daily as
select
  paid_at::date as date,
  count(*)::int as order_count,
  count(*) filter (where order_type = 'Dine In')::int as dine_in_count,
  count(*) filter (where order_type = 'Take Away')::int as take_away_count,
  count(*) filter (where order_type = 'Delivery')::int as delivery_count,
  coalesce(sum(total), 0)::numeric(14,2) as revenue,
  coalesce(avg(nullif(total, 0)), 0)::numeric(14,2) as average_order
from public.report_sales_records
where order_status <> 'Dibatalkan'
group by paid_at::date;

grant usage on schema public to anon;
grant select on public.report_sales_records to anon;
grant select on public.report_profit_yearly to anon;
grant select on public.report_profit_monthly to anon;
grant select on public.report_profit_daily to anon;
grant select on public.report_payment_summary_daily to anon;
grant select on public.report_order_type_summary_daily to anon;
grant select on public.report_visitor_summary_daily to anon;

commit;



-- ============================================================================
-- SECTION: docs\public_report_read_policy.sql
-- ============================================================================

-- Optional: izinkan laporan dibaca tanpa login Supabase.
-- Jalankan ini kalau ingin halaman laporan langsung muncul tanpa login.
-- Ini hanya membuka akses SELECT/read. Import, transaksi, dan edit data tetap perlu login.

grant usage on schema public to anon;
grant select on public.report_sales_records to anon;
grant select on public.report_profit_yearly to anon;
grant select on public.report_profit_monthly to anon;
grant select on public.report_profit_daily to anon;
grant select on public.report_payment_summary_daily to anon;
grant select on public.report_order_type_summary_daily to anon;
grant select on public.report_visitor_summary_daily to anon;
grant select on public.legacy_sales to anon;

drop policy if exists anon_read_legacy_sales on public.legacy_sales;
create policy anon_read_legacy_sales on public.legacy_sales
  for select
  using (true);

drop policy if exists anon_read_orders on public.orders;
create policy anon_read_orders on public.orders
  for select
  using (true);

drop policy if exists anon_read_payments on public.payments;
create policy anon_read_payments on public.payments
  for select
  using (true);



-- ============================================================================
-- SECTION: docs\supabase_realtime_enable.sql
-- ============================================================================

-- Kasirin! realtime enablement
-- Jalankan setelah docs/supabase_full_integration_migration.sql.
-- Supabase Realtime harus mem-publish tabel yang dipakai antar-device.

begin;

alter table if exists public.orders replica identity full;
alter table if exists public.order_items replica identity full;
alter table if exists public.order_item_addons replica identity full;
alter table if exists public.payments replica identity full;
alter table if exists public.products replica identity full;
alter table if exists public.product_addons replica identity full;
alter table if exists public.addons replica identity full;
alter table if exists public.categories replica identity full;
alter table if exists public.stock_movements replica identity full;

do $$
declare
  realtime_table_name text;
begin
  foreach realtime_table_name in array array[
    'orders',
    'order_items',
    'order_item_addons',
    'payments',
    'products',
    'product_addons',
    'addons',
    'categories',
    'stock_movements'
  ]
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = realtime_table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', realtime_table_name);
    end if;
  end loop;
end $$;

commit;



-- ============================================================================
-- SECTION: supabase\migrations\202608010001_stock_audit_movements_realtime.sql
-- ============================================================================

-- Persist and publish stock opname audit movements across devices.
-- Safe to run more than once.

begin;

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  qty numeric(14,2) not null,
  reason text not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.staff_profiles(id) on delete set null
);

alter table if exists public.stock_movements
  add column if not exists product_local_id text,
  add column if not exists variant_key text,
  add column if not exists variant_label text,
  add column if not exists movement_type text not null default 'adjustment',
  add column if not exists balance_after numeric(14,2),
  add column if not exists note text;

create index if not exists idx_stock_movements_created
  on public.stock_movements(created_at desc);

create index if not exists idx_stock_movements_product
  on public.stock_movements(product_id, created_at desc);

create index if not exists idx_stock_movements_product_local
  on public.stock_movements(product_local_id, created_at desc);

alter table if exists public.stock_movements replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'stock_movements'
  ) then
    alter publication supabase_realtime add table public.stock_movements;
  end if;
end $$;

commit;



-- ============================================================================
-- SECTION: supabase\migrations\202608030001_limited_stock_reservations.sql
-- ============================================================================

-- Atomic limited-stock reservations for POS and Self Order.
-- Safe to run more than once in the Supabase SQL Editor.

begin;

create extension if not exists pgcrypto;

alter table if exists public.products
  add column if not exists local_id text,
  add column if not exists sold_out_variants jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.stock_movements
  add column if not exists product_local_id text,
  add column if not exists variant_key text,
  add column if not exists variant_label text,
  add column if not exists movement_type text not null default 'adjustment',
  add column if not exists balance_after numeric(14,2),
  add column if not exists note text;

create table if not exists public.limited_stock_reservations (
  id uuid primary key default gen_random_uuid(),
  cart_token text not null,
  source text not null check (source in ('POS', 'Self Order')),
  product_id uuid not null references public.products(id) on delete cascade,
  product_local_id text not null,
  variant_key text not null default '',
  qty numeric(14,2) not null check (qty > 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cart_token, product_id, variant_key)
);

create index if not exists idx_limited_stock_reservations_active
  on public.limited_stock_reservations(product_id, variant_key, expires_at);

create index if not exists idx_limited_stock_reservations_cart
  on public.limited_stock_reservations(cart_token, expires_at);

create table if not exists public.limited_stock_commits (
  cart_token text primary key,
  order_number text not null,
  source text not null,
  items jsonb not null default '[]'::jsonb,
  committed_at timestamptz not null default now(),
  restored_at timestamptz
);

alter table public.limited_stock_commits
  drop constraint if exists limited_stock_commits_order_number_key;

create index if not exists idx_limited_stock_commits_order
  on public.limited_stock_commits(order_number);

create or replace function public.limited_stock_variant_state(
  p_product jsonb,
  p_variant_key text default ''
)
returns table(tracked boolean, stock numeric, label text)
language plpgsql
immutable
set search_path = public
as $$
declare
  v_option jsonb;
  v_parent jsonb;
  v_parent_name text;
  v_child_name text;
begin
  if coalesce(p_product->>'variant_mode', 'off') = 'off' then
    tracked := coalesce((p_product->>'track_stock')::boolean, false);
    stock := greatest(0, coalesce((p_product->>'stock')::numeric, 0));
    label := coalesce(p_product->>'name', 'Produk');
    return next;
    return;
  end if;

  if coalesce(p_product->>'variant_mode', 'off') = '2' then
    v_parent_name := split_part(coalesce(p_variant_key, ''), '|||', 1);
    v_child_name := split_part(coalesce(p_variant_key, ''), '|||', 2);
    select value into v_parent
    from jsonb_array_elements(coalesce(p_product->'variant_options', '[]'::jsonb))
    where value->>'name' = v_parent_name
    limit 1;
    select value into v_option
    from jsonb_array_elements(coalesce(v_parent->'children', '[]'::jsonb))
    where value->>'name' = v_child_name
    limit 1;
    label := concat_ws(' / ', nullif(v_parent_name, ''), nullif(v_child_name, ''));
  else
    select value into v_option
    from jsonb_array_elements(coalesce(p_product->'variant_options', '[]'::jsonb))
    where value->>'name' = coalesce(p_variant_key, '')
    limit 1;
    label := coalesce(v_option->>'name', p_variant_key, 'Varian');
  end if;

  tracked := coalesce((v_option->>'trackStock')::boolean, false);
  stock := greatest(0, coalesce((v_option->>'stock')::numeric, 0));
  return next;
end;
$$;

create or replace function public.limited_stock_set_variant_stock(
  p_options jsonb,
  p_variant_mode text,
  p_variant_key text,
  p_stock numeric
)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_result jsonb := '[]'::jsonb;
  v_children jsonb;
  v_option jsonb;
  v_child jsonb;
  v_parent_name text := split_part(coalesce(p_variant_key, ''), '|||', 1);
  v_child_name text := split_part(coalesce(p_variant_key, ''), '|||', 2);
  v_stock numeric := greatest(0, coalesce(p_stock, 0));
begin
  for v_option in select value from jsonb_array_elements(coalesce(p_options, '[]'::jsonb)) loop
    if p_variant_mode = '2' and v_option->>'name' = v_parent_name then
      v_children := '[]'::jsonb;
      for v_child in select value from jsonb_array_elements(coalesce(v_option->'children', '[]'::jsonb)) loop
        if v_child->>'name' = v_child_name then
          v_child := jsonb_set(v_child, '{stock}', to_jsonb(v_stock), true);
          if v_stock <= 0 then
            v_child := jsonb_set(v_child, '{stockAutoSoldOut}', 'true'::jsonb, true);
          else
            v_child := v_child - 'stockAutoSoldOut';
          end if;
        end if;
        v_children := v_children || jsonb_build_array(v_child);
      end loop;
      v_option := jsonb_set(v_option, '{children}', v_children, true);
    elsif p_variant_mode <> '2' and v_option->>'name' = p_variant_key then
      v_option := jsonb_set(v_option, '{stock}', to_jsonb(v_stock), true);
      if v_stock <= 0 then
        v_option := jsonb_set(v_option, '{stockAutoSoldOut}', 'true'::jsonb, true);
      else
        v_option := v_option - 'stockAutoSoldOut';
      end if;
    end if;
    v_result := v_result || jsonb_build_array(v_option);
  end loop;
  return v_result;
end;
$$;

drop function if exists public.limited_stock_reservation_totals(text);

create function public.limited_stock_reservation_totals(p_cart_token text default '')
returns table(
  product_local_id text,
  variant_key text,
  reserved_total numeric,
  reserved_by_cart numeric,
  next_expires_at timestamptz,
  own_expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.limited_stock_reservations r where r.expires_at <= now();
  return query
  select
    r.product_local_id,
    r.variant_key,
    sum(r.qty)::numeric,
    sum(case when r.cart_token = coalesce(p_cart_token, '') then r.qty else 0 end)::numeric,
    min(r.expires_at),
    max(case when r.cart_token = coalesce(p_cart_token, '') then r.expires_at else null end)
  from public.limited_stock_reservations r
  where r.expires_at > now()
  group by r.product_local_id, r.variant_key;
end;
$$;

create or replace function public.reserve_limited_stock(
  p_cart_token text,
  p_product_local_id text,
  p_variant_key text default '',
  p_qty numeric default 0,
  p_source text default 'POS',
  p_ttl_seconds integer default 600
)
returns table(
  accepted boolean,
  available numeric,
  reserved numeric,
  expires_at timestamptz,
  product_name text,
  variant_label text,
  reason text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product public.products%rowtype;
  v_tracked boolean := false;
  v_stock numeric := 0;
  v_label text := '';
  v_others numeric := 0;
  v_existing numeric := 0;
  v_available numeric := 0;
  v_expires timestamptz;
  v_variant_key text := coalesce(p_variant_key, '');
  v_qty numeric := greatest(0, floor(coalesce(p_qty, 0)));
begin
  if length(trim(coalesce(p_cart_token, ''))) < 12 then
    raise exception 'Token keranjang tidak valid';
  end if;
  if p_source not in ('POS', 'Self Order') then
    raise exception 'Sumber reservasi tidak valid';
  end if;

  select * into v_product
  from public.products
  where local_id = p_product_local_id or id::text = p_product_local_id
  order by case when local_id = p_product_local_id then 0 else 1 end
  limit 1
  for update;

  if not found then
    return query select false, 0::numeric, 0::numeric, null::timestamptz, 'Produk'::text, v_variant_key, 'not_found'::text;
    return;
  end if;

  select s.tracked, s.stock, s.label
  into v_tracked, v_stock, v_label
  from public.limited_stock_variant_state(to_jsonb(v_product), v_variant_key) s;

  delete from public.limited_stock_reservations r
  where r.product_id = v_product.id and r.variant_key = v_variant_key and r.expires_at <= now();

  select coalesce(sum(qty), 0) into v_others
  from public.limited_stock_reservations r
  where r.product_id = v_product.id
    and r.variant_key = v_variant_key
    and r.cart_token <> p_cart_token
    and r.expires_at > now();

  select coalesce(max(qty), 0) into v_existing
  from public.limited_stock_reservations r
  where r.product_id = v_product.id
    and r.variant_key = v_variant_key
    and r.cart_token = p_cart_token
    and r.expires_at > now();

  v_available := greatest(0, v_stock - v_others);
  if not v_tracked then
    delete from public.limited_stock_reservations
    where product_id = v_product.id and variant_key = v_variant_key and cart_token = p_cart_token;
    return query select true, v_stock, 0::numeric, null::timestamptz, v_product.name, v_label, 'not_limited'::text;
    return;
  end if;
  if v_product.sold_out or coalesce((v_product.sold_out_variants->>v_variant_key)::boolean, false) then
    return query select false, 0::numeric, v_existing, null::timestamptz, v_product.name, v_label, 'sold_out'::text;
    return;
  end if;
  if v_qty > v_available then
    return query select false, v_available, v_existing, null::timestamptz, v_product.name, v_label, 'insufficient'::text;
    return;
  end if;
  if v_qty <= 0 then
    delete from public.limited_stock_reservations
    where product_id = v_product.id and variant_key = v_variant_key and cart_token = p_cart_token;
    return query select true, v_available, 0::numeric, null::timestamptz, v_product.name, v_label, 'released'::text;
    return;
  end if;

  v_expires := now() + make_interval(secs => greatest(60, least(coalesce(p_ttl_seconds, 600), 7200)));
  insert into public.limited_stock_reservations(
    cart_token, source, product_id, product_local_id, variant_key, qty, expires_at, updated_at
  ) values (
    p_cart_token, p_source, v_product.id, coalesce(v_product.local_id, v_product.id::text), v_variant_key, v_qty, v_expires, now()
  )
  on conflict (cart_token, product_id, variant_key) do update
  set qty = excluded.qty,
      source = excluded.source,
      product_local_id = excluded.product_local_id,
      expires_at = excluded.expires_at,
      updated_at = now();

  return query select true, v_available, v_qty, v_expires, v_product.name, v_label, 'reserved'::text;
end;
$$;

create or replace function public.release_limited_stock_reservations(p_cart_token text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  delete from public.limited_stock_reservations where cart_token = p_cart_token;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.commit_limited_stock_reservations(
  p_cart_token text,
  p_order_number text,
  p_source text default 'POS'
)
returns table(accepted boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reservation public.limited_stock_reservations%rowtype;
  v_product public.products%rowtype;
  v_tracked boolean;
  v_stock numeric;
  v_label text;
  v_next_stock numeric;
  v_items jsonb;
  v_existing_order text;
begin
  select order_number into v_existing_order
  from public.limited_stock_commits where cart_token = p_cart_token;
  if found then
    return query select (v_existing_order = p_order_number), case when v_existing_order = p_order_number then 'already_committed' else 'token_reused' end;
    return;
  end if;

  if exists (
    select 1 from public.limited_stock_reservations
    where cart_token = p_cart_token and expires_at <= now()
  ) then
    delete from public.limited_stock_reservations where cart_token = p_cart_token and expires_at <= now();
    return query select false, 'expired'::text;
    return;
  end if;

  select jsonb_agg(jsonb_build_object(
    'productId', product_local_id,
    'variantKey', variant_key,
    'qty', qty
  ) order by product_id, variant_key)
  into v_items
  from public.limited_stock_reservations
  where cart_token = p_cart_token and expires_at > now();

  if v_items is null then
    return query select true, 'no_limited_stock'::text;
    return;
  end if;

  -- Lock every affected product in a stable order, then validate the whole cart
  -- before changing any stock. A rejected multi-item checkout remains all-or-nothing.
  for v_product in
    select p.*
    from public.products p
    where p.id in (
      select r.product_id
      from public.limited_stock_reservations r
      where r.cart_token = p_cart_token and r.expires_at > now()
    )
    order by p.id
    for update
  loop
    null;
  end loop;

  for v_reservation in
    select * from public.limited_stock_reservations
    where cart_token = p_cart_token and expires_at > now()
    order by product_id, variant_key
  loop
    select * into v_product from public.products where id = v_reservation.product_id;
    select s.tracked, s.stock, s.label into v_tracked, v_stock, v_label
    from public.limited_stock_variant_state(to_jsonb(v_product), v_reservation.variant_key) s;
    if not v_tracked or v_stock < v_reservation.qty then
      return query select false, 'stock_changed'::text;
      return;
    end if;
  end loop;

  for v_reservation in
    select * from public.limited_stock_reservations
    where cart_token = p_cart_token and expires_at > now()
    order by product_id, variant_key
  loop
    select * into v_product from public.products where id = v_reservation.product_id for update;
    select s.tracked, s.stock, s.label into v_tracked, v_stock, v_label
    from public.limited_stock_variant_state(to_jsonb(v_product), v_reservation.variant_key) s;
    if not v_tracked or v_stock < v_reservation.qty then
      return query select false, 'stock_changed'::text;
      return;
    end if;
    v_next_stock := greatest(0, v_stock - v_reservation.qty);
    if coalesce(v_product.variant_mode, 'off') = 'off' then
      update public.products
      set stock = v_next_stock,
          sold_out = case when v_next_stock <= 0 then true else sold_out end,
          updated_at = now()
      where id = v_product.id;
    else
      update public.products
      set variant_options = public.limited_stock_set_variant_stock(variant_options, variant_mode, v_reservation.variant_key, v_next_stock),
          sold_out_variants = case
            when v_next_stock <= 0 then jsonb_set(coalesce(sold_out_variants, '{}'::jsonb), array[v_reservation.variant_key], 'true'::jsonb, true)
            else coalesce(sold_out_variants, '{}'::jsonb) - v_reservation.variant_key
          end,
          updated_at = now()
      where id = v_product.id;
    end if;
    insert into public.stock_movements(product_id, product_local_id, variant_key, variant_label, qty, reason, movement_type, balance_after)
    values (v_product.id, v_reservation.product_local_id, v_reservation.variant_key, v_label, -v_reservation.qty, 'Reservasi ' || p_order_number, 'sale', v_next_stock);
  end loop;

  insert into public.limited_stock_commits(cart_token, order_number, source, items)
  values (p_cart_token, p_order_number, p_source, v_items);
  delete from public.limited_stock_reservations where cart_token = p_cart_token;
  return query select true, 'committed'::text;
end;
$$;

create or replace function public.restore_limited_stock_commit(p_order_number text)
returns table(restored boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_commit public.limited_stock_commits%rowtype;
  v_item jsonb;
  v_product public.products%rowtype;
  v_tracked boolean;
  v_stock numeric;
  v_label text;
  v_next_stock numeric;
  v_found boolean := false;
begin
  for v_commit in
    select * from public.limited_stock_commits
    where order_number = p_order_number and restored_at is null
    order by committed_at, cart_token
    for update
  loop
    v_found := true;
    for v_item in select value from jsonb_array_elements(v_commit.items) loop
      select * into v_product
      from public.products
      where local_id = v_item->>'productId' or id::text = v_item->>'productId'
      limit 1
      for update;
      if not found then continue; end if;
      select s.tracked, s.stock, s.label into v_tracked, v_stock, v_label
      from public.limited_stock_variant_state(to_jsonb(v_product), coalesce(v_item->>'variantKey', '')) s;
      v_next_stock := greatest(0, v_stock + greatest(0, coalesce((v_item->>'qty')::numeric, 0)));
      if coalesce(v_product.variant_mode, 'off') = 'off' then
        update public.products set stock = v_next_stock, sold_out = false, updated_at = now() where id = v_product.id;
      else
        update public.products
        set variant_options = public.limited_stock_set_variant_stock(variant_options, variant_mode, coalesce(v_item->>'variantKey', ''), v_next_stock),
            sold_out_variants = coalesce(sold_out_variants, '{}'::jsonb) - coalesce(v_item->>'variantKey', ''),
            updated_at = now()
        where id = v_product.id;
      end if;
      insert into public.stock_movements(product_id, product_local_id, variant_key, variant_label, qty, reason, movement_type, balance_after)
      values (v_product.id, v_item->>'productId', coalesce(v_item->>'variantKey', ''), v_label, (v_item->>'qty')::numeric, 'Pembatalan ' || p_order_number, 'cancel_restore', v_next_stock);
    end loop;
    update public.limited_stock_commits set restored_at = now() where cart_token = v_commit.cart_token;
  end loop;
  if not v_found then
    if exists (select 1 from public.limited_stock_commits where order_number = p_order_number and restored_at is not null) then
      return query select true, 'already_restored'::text;
    else
      return query select false, 'not_found'::text;
    end if;
    return;
  end if;
  return query select true, 'restored'::text;
end;
$$;

create or replace function public.require_self_order_customer_name()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if lower(trim(coalesce(new.source, ''))) = 'self order'
     and trim(coalesce(new.customer_name, '')) = '' then
    raise exception 'Self Order membutuhkan nama pelanggan';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_require_self_order_customer_name on public.orders;
create trigger trg_require_self_order_customer_name
before insert or update of source, customer_name on public.orders
for each row execute function public.require_self_order_customer_name();

alter table public.limited_stock_reservations disable row level security;
alter table public.limited_stock_commits disable row level security;
revoke all on table public.limited_stock_reservations from anon, authenticated;
revoke all on table public.limited_stock_commits from anon, authenticated;
grant select on public.limited_stock_reservations to anon, authenticated;
revoke all on function public.limited_stock_reservation_totals(text) from public;
revoke all on function public.reserve_limited_stock(text, text, text, numeric, text, integer) from public;
revoke all on function public.release_limited_stock_reservations(text) from public;
revoke all on function public.commit_limited_stock_reservations(text, text, text) from public;
revoke all on function public.restore_limited_stock_commit(text) from public;
grant execute on function public.limited_stock_reservation_totals(text) to anon, authenticated;
grant execute on function public.reserve_limited_stock(text, text, text, numeric, text, integer) to anon, authenticated;
grant execute on function public.release_limited_stock_reservations(text) to anon, authenticated;
grant execute on function public.commit_limited_stock_reservations(text, text, text) to anon, authenticated;
grant execute on function public.restore_limited_stock_commit(text) to anon, authenticated;

alter table public.limited_stock_reservations replica identity full;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'limited_stock_reservations'
  ) then
    alter publication supabase_realtime add table public.limited_stock_reservations;
  end if;
end $$;

commit;



-- ============================================================================
-- SECTION: supabase\migrations\202608030002_operational_cleanup.sql
-- ============================================================================

begin;

create table if not exists public.maintenance_runs (
  job_name text primary key,
  last_started_at timestamptz,
  last_finished_at timestamptz,
  last_result jsonb not null default '{}'::jsonb
);

create or replace function public.cleanup_operational_data(
  p_retention_days integer default 31,
  p_min_interval_hours integer default 20
)
returns table(ran boolean, skipped boolean, deleted jsonb, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job text := 'operational_cleanup';
  v_retention_days integer := greatest(7, least(366, coalesce(p_retention_days, 31)));
  v_min_interval_hours integer := greatest(1, least(168, coalesce(p_min_interval_hours, 20)));
  v_cutoff timestamptz := now() - make_interval(days => v_retention_days);
  v_last_finished_at timestamptz;
  v_deleted jsonb := '{}'::jsonb;
  v_count integer := 0;
  v_lock_key bigint := hashtextextended('kasirin_operational_cleanup', 0);
begin
  if not pg_try_advisory_lock(v_lock_key) then
    return query select false, true, v_deleted, 'locked'::text;
    return;
  end if;

  select last_finished_at into v_last_finished_at
  from public.maintenance_runs
  where job_name = v_job;

  if v_last_finished_at is not null
    and v_last_finished_at > now() - make_interval(hours => v_min_interval_hours)
  then
    perform pg_advisory_unlock(v_lock_key);
    return query select false, true, coalesce((select last_result from public.maintenance_runs where job_name = v_job), v_deleted), 'recently_cleaned'::text;
    return;
  end if;

  insert into public.maintenance_runs(job_name, last_started_at, last_result)
  values (v_job, now(), jsonb_build_object('status', 'running'))
  on conflict (job_name) do update
    set last_started_at = excluded.last_started_at,
        last_result = excluded.last_result;

  if to_regclass('public.limited_stock_reservations') is not null then
    delete from public.limited_stock_reservations
    where expires_at <= now();
    get diagnostics v_count = row_count;
    v_deleted := v_deleted || jsonb_build_object('limited_stock_reservations', v_count);
  end if;

  if to_regclass('public.limited_stock_commits') is not null then
    delete from public.limited_stock_commits
    where created_at < v_cutoff;
    get diagnostics v_count = row_count;
    v_deleted := v_deleted || jsonb_build_object('limited_stock_commits', v_count);
  end if;

  if to_regclass('public.product_availability_events') is not null
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'product_availability_events' and column_name = 'created_at'
    )
  then
    execute 'delete from public.product_availability_events where created_at < $1' using v_cutoff;
    get diagnostics v_count = row_count;
    v_deleted := v_deleted || jsonb_build_object('product_availability_events', v_count);
  end if;

  if to_regclass('public.stock_movements') is not null
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'stock_movements' and column_name = 'created_at'
    )
  then
    execute 'delete from public.stock_movements where created_at < $1' using v_cutoff;
    get diagnostics v_count = row_count;
    v_deleted := v_deleted || jsonb_build_object('stock_movements', v_count);
  end if;

  if to_regclass('public.orders') is not null
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'orders' and column_name = 'created_at'
    )
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'orders' and column_name = 'payment_status'
    )
  then
    -- payment_status not in ('Lunas', 'Paid', 'Dibayar', 'Sudah bayar', 'Selesai bayar')
    if to_regclass('public.order_item_addons') is not null and to_regclass('public.order_items') is not null then
      execute $cleanup$
        with old_orders as (
          select id from public.orders
          where created_at < $1
            and coalesce(payment_status, '') not in ('Lunas', 'Paid', 'Dibayar', 'Sudah bayar', 'Selesai bayar')
        )
        delete from public.order_item_addons addon
        using public.order_items item, old_orders old_order
        where addon.order_item_id = item.id and item.order_id = old_order.id
      $cleanup$ using v_cutoff;
      get diagnostics v_count = row_count;
      v_deleted := v_deleted || jsonb_build_object('order_item_addons', v_count);
    end if;

    if to_regclass('public.payments') is not null then
      execute $cleanup$
        with old_orders as (
          select id from public.orders
          where created_at < $1
            and coalesce(payment_status, '') not in ('Lunas', 'Paid', 'Dibayar', 'Sudah bayar', 'Selesai bayar')
        )
        delete from public.payments payment
        using old_orders old_order
        where payment.order_id = old_order.id
      $cleanup$ using v_cutoff;
      get diagnostics v_count = row_count;
      v_deleted := v_deleted || jsonb_build_object('payments', v_count);
    end if;

    if to_regclass('public.order_items') is not null then
      execute $cleanup$
        with old_orders as (
          select id from public.orders
          where created_at < $1
            and coalesce(payment_status, '') not in ('Lunas', 'Paid', 'Dibayar', 'Sudah bayar', 'Selesai bayar')
        )
        delete from public.order_items item
        using old_orders old_order
        where item.order_id = old_order.id
      $cleanup$ using v_cutoff;
      get diagnostics v_count = row_count;
      v_deleted := v_deleted || jsonb_build_object('order_items', v_count);
    end if;

    execute $cleanup$
      delete from public.orders
      where created_at < $1
        and coalesce(payment_status, '') not in ('Lunas', 'Paid', 'Dibayar', 'Sudah bayar', 'Selesai bayar')
    $cleanup$ using v_cutoff;
    get diagnostics v_count = row_count;
    v_deleted := v_deleted || jsonb_build_object('orders', v_count);
  end if;

  update public.maintenance_runs
  set last_finished_at = now(),
      last_result = jsonb_build_object(
        'status', 'completed',
        'retentionDays', v_retention_days,
        'cutoff', v_cutoff,
        'deleted', v_deleted
      )
  where job_name = v_job;

  perform pg_advisory_unlock(v_lock_key);
  return query select true, false, v_deleted, 'completed'::text;
exception when others then
  perform pg_advisory_unlock(v_lock_key);
  update public.maintenance_runs
  set last_finished_at = now(),
      last_result = jsonb_build_object('status', 'failed', 'message', sqlerrm)
  where job_name = v_job;
  raise;
end;
$$;

revoke all on table public.maintenance_runs from anon, authenticated;
grant select on table public.maintenance_runs to anon, authenticated;

revoke all on function public.cleanup_operational_data(integer, integer) from public;
grant execute on function public.cleanup_operational_data(integer, integer) to anon, authenticated;

notify pgrst, 'reload schema';

commit;



-- ============================================================================
-- SECTION: supabase\migrations\202608050001_device_push_kitchen_categories.sql
-- ============================================================================

alter table public.device_push_tokens
  add column if not exists kitchen_categories text[] not null default '{}'::text[];



-- ============================================================================
-- SECTION: supabase\migrations\202608050002_report_paid_at_order.sql
-- ============================================================================

-- Order financial reports by payment time.
-- Safe to rerun: this only rebuilds reporting views.

begin;

drop view if exists public.report_profit_daily cascade;
drop view if exists public.report_profit_monthly cascade;
drop view if exists public.report_profit_yearly cascade;
drop view if exists public.report_payment_summary_daily cascade;
drop view if exists public.report_order_type_summary_daily cascade;
drop view if exists public.report_visitor_summary_daily cascade;
drop view if exists public.report_sales_records cascade;

create or replace view public.report_sales_records as
select
  o.id,
  o.order_number as number,
  o.created_at,
  coalesce(p.paid_at, o.created_at) as paid_at,
  o.source,
  o.type::text as order_type,
  coalesce(o.customer_name, '-') as customer_name,
  coalesce(o.service_info, '-') as service_info,
  o.status::text as order_status,
  o.payment_status::text as payment_status,
  coalesce(p.method, 'Belum dipilih') as payment_method,
  coalesce(o.subtotal, 0)::numeric(14,2) as subtotal,
  coalesce(o.discount, 0)::numeric(14,2) as discount,
  coalesce(to_jsonb(o)->>'discount_mode', 'amount') as discount_mode,
  coalesce(o.grand_total, 0)::numeric(14,2) as total,
  coalesce(o.profit_total, 0)::numeric(14,2) as profit,
  coalesce(to_jsonb(o)->>'cancel_reason', '') as cancel_reason,
  false as imported
from public.orders o
left join lateral (
  select method, paid_at
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
  l.created_at as paid_at,
  'Import Kasir Lama' as source,
  l.order_type,
  coalesce(l.customer_name, '-') as customer_name,
  coalesce(l.customer_name, '-') as service_info,
  'Selesai' as order_status,
  coalesce(l.payment_status, 'Lunas') as payment_status,
  coalesce(l.payment_method, 'Cash dan Piutang') as payment_method,
  coalesce(l.subtotal, 0)::numeric(14,2) as subtotal,
  coalesce(l.discount, 0)::numeric(14,2) as discount,
  'amount' as discount_mode,
  coalesce(l.total, 0)::numeric(14,2) as total,
  coalesce(l.profit, 0)::numeric(14,2) as profit,
  '' as cancel_reason,
  true as imported
from public.legacy_sales l;

create or replace view public.report_profit_yearly as
select
  extract(year from paid_at)::int as year,
  count(*)::int as transaction_count,
  coalesce(sum(total), 0)::numeric(14,2) as total,
  coalesce(sum(total), 0)::numeric(14,2) as revenue,
  coalesce(sum(profit), 0)::numeric(14,2) as profit,
  coalesce(sum(total - profit), 0)::numeric(14,2) as estimated_cost
from public.report_sales_records
where payment_status = 'Lunas'
  and order_status <> 'Dibatalkan'
  and (
    order_status = 'Selesai'
    or lower(coalesce(source, '')) like '%kasir%'
    or lower(coalesce(source, '')) like '%pos%'
  )
group by extract(year from paid_at)::int;

create or replace view public.report_profit_monthly as
select
  extract(year from paid_at)::int as year,
  extract(month from paid_at)::int as month,
  count(*)::int as transaction_count,
  coalesce(sum(total), 0)::numeric(14,2) as total,
  coalesce(sum(total), 0)::numeric(14,2) as revenue,
  coalesce(sum(profit), 0)::numeric(14,2) as profit,
  coalesce(sum(total - profit), 0)::numeric(14,2) as estimated_cost
from public.report_sales_records
where payment_status = 'Lunas'
  and order_status <> 'Dibatalkan'
  and (
    order_status = 'Selesai'
    or lower(coalesce(source, '')) like '%kasir%'
    or lower(coalesce(source, '')) like '%pos%'
  )
group by
  extract(year from paid_at)::int,
  extract(month from paid_at)::int;

create or replace view public.report_profit_daily as
select
  extract(year from paid_at)::int as year,
  extract(month from paid_at)::int as month,
  extract(day from paid_at)::int as day,
  paid_at::date as sales_date,
  paid_at::date as date,
  count(*)::int as transaction_count,
  coalesce(sum(total), 0)::numeric(14,2) as total,
  coalesce(sum(total), 0)::numeric(14,2) as revenue,
  coalesce(sum(profit), 0)::numeric(14,2) as profit,
  coalesce(sum(total - profit), 0)::numeric(14,2) as estimated_cost
from public.report_sales_records
where payment_status = 'Lunas'
  and order_status <> 'Dibatalkan'
  and (
    order_status = 'Selesai'
    or lower(coalesce(source, '')) like '%kasir%'
    or lower(coalesce(source, '')) like '%pos%'
  )
group by
  extract(year from paid_at)::int,
  extract(month from paid_at)::int,
  extract(day from paid_at)::int,
  paid_at::date;

create or replace view public.report_payment_summary_daily as
select
  paid_at::date as date,
  payment_method,
  count(*)::int as transaction_count,
  coalesce(sum(total), 0)::numeric(14,2) as revenue
from public.report_sales_records
where payment_status = 'Lunas'
  and order_status <> 'Dibatalkan'
  and (
    order_status = 'Selesai'
    or lower(coalesce(source, '')) like '%kasir%'
    or lower(coalesce(source, '')) like '%pos%'
  )
group by paid_at::date, payment_method;

create or replace view public.report_order_type_summary_daily as
select
  paid_at::date as date,
  order_type,
  count(*)::int as order_count,
  coalesce(sum(total), 0)::numeric(14,2) as revenue
from public.report_sales_records
where order_status <> 'Dibatalkan'
group by paid_at::date, order_type;

create or replace view public.report_visitor_summary_daily as
select
  paid_at::date as date,
  count(*)::int as order_count,
  count(*) filter (where order_type = 'Dine In')::int as dine_in_count,
  count(*) filter (where order_type = 'Take Away')::int as take_away_count,
  count(*) filter (where order_type = 'Delivery')::int as delivery_count,
  coalesce(sum(total), 0)::numeric(14,2) as revenue,
  coalesce(avg(nullif(total, 0)), 0)::numeric(14,2) as average_order
from public.report_sales_records
where order_status <> 'Dibatalkan'
group by paid_at::date;

grant usage on schema public to anon;
grant select on public.report_sales_records to anon;
grant select on public.report_profit_yearly to anon;
grant select on public.report_profit_monthly to anon;
grant select on public.report_profit_daily to anon;
grant select on public.report_payment_summary_daily to anon;
grant select on public.report_order_type_summary_daily to anon;
grant select on public.report_visitor_summary_daily to anon;

commit;



-- ============================================================================
-- SECTION: supabase\migrations\202608050003_mixed_payment_breakdown.sql
-- ============================================================================

-- Store split Cash/QRIS values for mixed POS payments.
-- Safe to rerun.

begin;

alter table if exists public.payments
  add column if not exists payment_breakdown jsonb not null default '{}'::jsonb;

drop view if exists public.report_profit_daily cascade;
drop view if exists public.report_profit_monthly cascade;
drop view if exists public.report_profit_yearly cascade;
drop view if exists public.report_payment_summary_daily cascade;
drop view if exists public.report_order_type_summary_daily cascade;
drop view if exists public.report_visitor_summary_daily cascade;
drop view if exists public.report_sales_records cascade;

create or replace view public.report_sales_records as
select
  o.id,
  o.order_number as number,
  o.created_at,
  coalesce(p.paid_at, o.created_at) as paid_at,
  o.source,
  o.type::text as order_type,
  coalesce(o.customer_name, '-') as customer_name,
  coalesce(o.service_info, '-') as service_info,
  o.status::text as order_status,
  o.payment_status::text as payment_status,
  coalesce(p.method, 'Belum dipilih') as payment_method,
  coalesce(p.payment_breakdown, '{}'::jsonb) as payment_breakdown,
  coalesce(o.subtotal, 0)::numeric(14,2) as subtotal,
  coalesce(o.discount, 0)::numeric(14,2) as discount,
  coalesce(to_jsonb(o)->>'discount_mode', 'amount') as discount_mode,
  coalesce(o.grand_total, 0)::numeric(14,2) as total,
  coalesce(o.profit_total, 0)::numeric(14,2) as profit,
  coalesce(to_jsonb(o)->>'cancel_reason', '') as cancel_reason,
  false as imported
from public.orders o
left join lateral (
  select method, paid_at, payment_breakdown
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
  l.created_at as paid_at,
  'Import Kasir Lama' as source,
  l.order_type,
  coalesce(l.customer_name, '-') as customer_name,
  coalesce(l.customer_name, '-') as service_info,
  'Selesai' as order_status,
  coalesce(l.payment_status, 'Lunas') as payment_status,
  coalesce(l.payment_method, 'Cash dan Piutang') as payment_method,
  '{}'::jsonb as payment_breakdown,
  coalesce(l.subtotal, 0)::numeric(14,2) as subtotal,
  coalesce(l.discount, 0)::numeric(14,2) as discount,
  'amount' as discount_mode,
  coalesce(l.total, 0)::numeric(14,2) as total,
  coalesce(l.profit, 0)::numeric(14,2) as profit,
  '' as cancel_reason,
  true as imported
from public.legacy_sales l;

create or replace view public.report_profit_yearly as
select
  extract(year from paid_at)::int as year,
  count(*)::int as transaction_count,
  coalesce(sum(total), 0)::numeric(14,2) as total,
  coalesce(sum(total), 0)::numeric(14,2) as revenue,
  coalesce(sum(profit), 0)::numeric(14,2) as profit,
  coalesce(sum(total - profit), 0)::numeric(14,2) as estimated_cost
from public.report_sales_records
where payment_status = 'Lunas'
  and order_status <> 'Dibatalkan'
  and (
    order_status = 'Selesai'
    or lower(coalesce(source, '')) like '%kasir%'
    or lower(coalesce(source, '')) like '%pos%'
  )
group by extract(year from paid_at)::int;

create or replace view public.report_profit_monthly as
select
  extract(year from paid_at)::int as year,
  extract(month from paid_at)::int as month,
  count(*)::int as transaction_count,
  coalesce(sum(total), 0)::numeric(14,2) as total,
  coalesce(sum(total), 0)::numeric(14,2) as revenue,
  coalesce(sum(profit), 0)::numeric(14,2) as profit,
  coalesce(sum(total - profit), 0)::numeric(14,2) as estimated_cost
from public.report_sales_records
where payment_status = 'Lunas'
  and order_status <> 'Dibatalkan'
  and (
    order_status = 'Selesai'
    or lower(coalesce(source, '')) like '%kasir%'
    or lower(coalesce(source, '')) like '%pos%'
  )
group by
  extract(year from paid_at)::int,
  extract(month from paid_at)::int;

create or replace view public.report_profit_daily as
select
  extract(year from paid_at)::int as year,
  extract(month from paid_at)::int as month,
  extract(day from paid_at)::int as day,
  paid_at::date as sales_date,
  paid_at::date as date,
  count(*)::int as transaction_count,
  coalesce(sum(total), 0)::numeric(14,2) as total,
  coalesce(sum(total), 0)::numeric(14,2) as revenue,
  coalesce(sum(profit), 0)::numeric(14,2) as profit,
  coalesce(sum(total - profit), 0)::numeric(14,2) as estimated_cost
from public.report_sales_records
where payment_status = 'Lunas'
  and order_status <> 'Dibatalkan'
  and (
    order_status = 'Selesai'
    or lower(coalesce(source, '')) like '%kasir%'
    or lower(coalesce(source, '')) like '%pos%'
  )
group by
  extract(year from paid_at)::int,
  extract(month from paid_at)::int,
  extract(day from paid_at)::int,
  paid_at::date;

create or replace view public.report_payment_summary_daily as
select
  paid_at::date as date,
  payment_method,
  count(*)::int as transaction_count,
  coalesce(sum(total), 0)::numeric(14,2) as revenue
from public.report_sales_records
where payment_status = 'Lunas'
  and order_status <> 'Dibatalkan'
  and (
    order_status = 'Selesai'
    or lower(coalesce(source, '')) like '%kasir%'
    or lower(coalesce(source, '')) like '%pos%'
  )
group by paid_at::date, payment_method;

create or replace view public.report_order_type_summary_daily as
select
  paid_at::date as date,
  order_type,
  count(*)::int as order_count,
  coalesce(sum(total), 0)::numeric(14,2) as revenue
from public.report_sales_records
where order_status <> 'Dibatalkan'
group by paid_at::date, order_type;

create or replace view public.report_visitor_summary_daily as
select
  paid_at::date as date,
  count(*)::int as order_count,
  count(*) filter (where order_type = 'Dine In')::int as dine_in_count,
  count(*) filter (where order_type = 'Take Away')::int as take_away_count,
  count(*) filter (where order_type = 'Delivery')::int as delivery_count,
  coalesce(sum(total), 0)::numeric(14,2) as revenue,
  coalesce(avg(nullif(total, 0)), 0)::numeric(14,2) as average_order
from public.report_sales_records
where order_status <> 'Dibatalkan'
group by paid_at::date;

grant usage on schema public to anon;
grant select on public.report_sales_records to anon;
grant select on public.report_profit_yearly to anon;
grant select on public.report_profit_monthly to anon;
grant select on public.report_profit_daily to anon;
grant select on public.report_payment_summary_daily to anon;
grant select on public.report_order_type_summary_daily to anon;
grant select on public.report_visitor_summary_daily to anon;

commit;



-- ============================================================================
-- SECTION: supabase\migrations\202608060001_server_time.sql
-- ============================================================================

-- Provide a trusted database timestamp for Self Order checkout.
-- Safe to rerun.

begin;

create or replace function public.get_server_time()
returns timestamptz
language sql
stable
set search_path = public
as $$
  select now();
$$;

grant execute on function public.get_server_time() to anon, authenticated;

commit;



-- ============================================================================
-- SECTION: supabase\migrations\202608120001_push_notification_delivery_timeout.sql
-- ============================================================================

-- Keep the database request alive while the Edge Function waits briefly for
-- order_items to be available for kitchen category filtering.
create or replace function public.kasirin_notify_order_push()
returns trigger
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  internal_secret text;
  event_type text;
  request_id bigint;
begin
  if tg_op = 'INSERT' then
    event_type := 'new_order';
  elsif tg_op = 'UPDATE' then
    if coalesce(new.grand_total, 0) <= coalesce(old.grand_total, 0)
      and coalesce(new.subtotal, 0) <= coalesce(old.subtotal, 0) then
      return new;
    end if;
    if coalesce(new.payment_status::text, '') <> coalesce(old.payment_status::text, '')
      and coalesce(new.grand_total, 0) = coalesce(old.grand_total, 0)
      and coalesce(new.subtotal, 0) = coalesce(old.subtotal, 0) then
      return new;
    end if;
    event_type := 'additional_order';
  else
    return new;
  end if;

  if coalesce(new.status::text, '') in ('Dibatalkan', 'Selesai') then
    return new;
  end if;

  select decrypted_secret
    into internal_secret
  from vault.decrypted_secrets
  where name = 'kasirin_push_internal_secret'
  limit 1;

  if nullif(internal_secret, '') is null then
    raise warning 'kasirin_push_internal_secret is not configured';
    return new;
  end if;

  select net.http_post(
    url := 'https://pjkotqianxecaawqompo.supabase.co/functions/v1/notify-new-order',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-kasirin-push-secret', internal_secret
    ),
    body := jsonb_build_object(
      'internal', true,
      'eventType', event_type,
      'orderId', new.id,
      'orderNumber', coalesce(new.order_number, ''),
      'source', coalesce(new.source, ''),
      'table', coalesce(nullif(new.table_label, ''), nullif(new.service_info, ''), ''),
      'customer', coalesce(new.customer_name, ''),
      'scopeKey', 'outlet-utama',
      'target', 'all',
      'tone', 'alert'
    ),
    timeout_milliseconds := 15000
  ) into request_id;

  return new;
exception
  when others then
    raise warning 'kasirin_notify_order_push failed: %', sqlerrm;
    return new;
end;
$$;



-- ============================================================================
-- SECTION: supabase\migrations\202608130001_order_notification_reminder_status.sql
-- ============================================================================

-- Read-only status endpoint used by the Android reminder receiver while the
-- WebView is closed. It exposes only one status value, not the order record.
drop function if exists public.kasirin_order_notification_status(uuid);

create or replace function public.kasirin_order_notification_status(p_order_id uuid)
returns table(status text)
language sql
stable
security definer
set search_path = public
as $$
  select orders.status::text
  from public.orders
  where orders.id = p_order_id
  limit 1;
$$;

revoke all on function public.kasirin_order_notification_status(uuid) from public;
grant execute on function public.kasirin_order_notification_status(uuid) to anon, authenticated;



-- ============================================================================
-- SECTION: supabase\migrations\202608130002_order_push_notification_categories.sql
-- ============================================================================

-- Store the exact category set for the notification event on the order row.
-- This avoids racing the order_items rewrite when an additional order arrives.
alter table public.orders
  add column if not exists notification_categories text[] not null default '{}'::text[];

drop function if exists public.kasirin_order_notification_status(uuid);
create function public.kasirin_order_notification_status(p_order_id uuid)
returns table(status text, notification_categories text[])
language sql
stable
security definer
set search_path = public
as $$
  select orders.status::text, coalesce(orders.notification_categories, '{}'::text[])
  from public.orders
  where orders.id = p_order_id
  limit 1;
$$;

revoke all on function public.kasirin_order_notification_status(uuid) from public;
grant execute on function public.kasirin_order_notification_status(uuid) to anon, authenticated;

create or replace function public.kasirin_notify_order_push()
returns trigger
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  internal_secret text;
  event_type text;
  request_id bigint;
begin
  if tg_op = 'INSERT' then
    event_type := 'new_order';
  elsif tg_op = 'UPDATE' then
    if coalesce(new.grand_total, 0) <= coalesce(old.grand_total, 0)
      and coalesce(new.subtotal, 0) <= coalesce(old.subtotal, 0) then
      return new;
    end if;
    if coalesce(new.payment_status::text, '') <> coalesce(old.payment_status::text, '')
      and coalesce(new.grand_total, 0) = coalesce(old.grand_total, 0)
      and coalesce(new.subtotal, 0) = coalesce(old.subtotal, 0) then
      return new;
    end if;
    event_type := 'additional_order';
  else
    return new;
  end if;

  if coalesce(new.status::text, '') in ('Dibatalkan', 'Selesai') then
    return new;
  end if;

  select decrypted_secret
    into internal_secret
  from vault.decrypted_secrets
  where name = 'kasirin_push_internal_secret'
  limit 1;

  if nullif(internal_secret, '') is null then
    raise warning 'kasirin_push_internal_secret is not configured';
    return new;
  end if;

  select net.http_post(
    url := 'https://pjkotqianxecaawqompo.supabase.co/functions/v1/notify-new-order',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-kasirin-push-secret', internal_secret
    ),
    body := jsonb_build_object(
      'internal', true,
      'eventType', event_type,
      'orderId', new.id,
      'orderNumber', coalesce(new.order_number, ''),
      'source', coalesce(new.source, ''),
      'table', coalesce(nullif(new.table_label, ''), nullif(new.service_info, ''), ''),
      'customer', coalesce(new.customer_name, ''),
      'scopeKey', 'outlet-utama',
      'target', 'all',
      'tone', 'alert',
      'orderCategories', coalesce(new.notification_categories, '{}'::text[])
    ),
    timeout_milliseconds := 15000
  ) into request_id;

  return new;
exception
  when others then
    raise warning 'kasirin_notify_order_push failed: %', sqlerrm;
    return new;
end;
$$;

drop trigger if exists trg_kasirin_notify_order_push on public.orders;
create trigger trg_kasirin_notify_order_push
  after insert or update on public.orders
  for each row
  execute function public.kasirin_notify_order_push();

notify pgrst, 'reload schema';



-- ============================================================================
-- SECTION: supabase\migrations\202608140001_so_takeaway_payment_gate.sql
-- ============================================================================

-- SO Takeaway payment gate.
-- Takeaway Self-Order rows may be visible in cashier while unpaid, but must not
-- notify or enter kitchen workflows until payment_status becomes Lunas.

create or replace function public.kasirin_notify_order_push()
returns trigger
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  internal_secret text;
  event_type text;
  request_id bigint;
begin
  if tg_op = 'INSERT' then
    if coalesce(new.type::text, '') = 'Take Away'
      and coalesce(new.source, '') = 'Self Order'
      and coalesce(new.payment_status::text, '') <> 'Lunas' then
      return new;
    end if;
    event_type := 'new_order';
  elsif tg_op = 'UPDATE' then
    if coalesce(new.type::text, '') = 'Take Away'
      and coalesce(new.source, '') = 'Self Order'
      and coalesce(old.payment_status::text, '') <> 'Lunas'
      and coalesce(new.payment_status::text, '') = 'Lunas' then
      event_type := 'new_order';
    elsif coalesce(new.grand_total, 0) <= coalesce(old.grand_total, 0)
      and coalesce(new.subtotal, 0) <= coalesce(old.subtotal, 0) then
      return new;
    elsif coalesce(new.payment_status::text, '') <> coalesce(old.payment_status::text, '')
      and coalesce(new.grand_total, 0) = coalesce(old.grand_total, 0)
      and coalesce(new.subtotal, 0) = coalesce(old.subtotal, 0) then
      return new;
    else
      event_type := 'additional_order';
    end if;
  else
    return new;
  end if;

  if coalesce(new.status::text, '') in ('Dibatalkan', 'Selesai') then
    return new;
  end if;

  select decrypted_secret
    into internal_secret
  from vault.decrypted_secrets
  where name = 'kasirin_push_internal_secret'
  limit 1;

  if nullif(internal_secret, '') is null then
    raise warning 'kasirin_push_internal_secret is not configured';
    return new;
  end if;

  select net.http_post(
    url := 'https://pjkotqianxecaawqompo.supabase.co/functions/v1/notify-new-order',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-kasirin-push-secret', internal_secret
    ),
    body := jsonb_build_object(
      'internal', true,
      'eventType', event_type,
      'orderId', new.id,
      'orderNumber', coalesce(new.order_number, ''),
      'source', coalesce(new.source, ''),
      'table', coalesce(nullif(new.service_info, ''), ''),
      'customer', coalesce(new.customer_name, ''),
      'scopeKey', 'outlet-utama',
      'target', 'all',
      'tone', 'alert',
      'orderCategories', coalesce(new.notification_categories, '{}'::text[])
    ),
    timeout_milliseconds := 15000
  ) into request_id;

  return new;
exception
  when others then
    raise warning 'kasirin_notify_order_push failed: %', sqlerrm;
    return new;
end;
$$;

drop trigger if exists trg_kasirin_notify_order_push on public.orders;
create trigger trg_kasirin_notify_order_push
  after insert or update on public.orders
  for each row
  execute function public.kasirin_notify_order_push();

notify pgrst, 'reload schema';



-- ============================================================================
-- SECTION: docs\disable_rls_for_local_app.sql
-- ============================================================================

-- Kasirin! local/simple mode: matikan RLS dan izinkan aplikasi memakai anon key tanpa login.
-- Jalankan file ini di Supabase SQL Editor kalau aplikasi hanya dipakai lokal/pribadi.
--
-- PERINGATAN:
-- Siapa pun yang punya Supabase URL + anon key bisa membaca dan mengubah data.
-- Jangan pakai mode ini kalau aplikasi dipublikasikan untuk umum.

alter table public.store_settings disable row level security;
alter table public.staff_profiles disable row level security;
alter table public.categories disable row level security;
alter table public.addons disable row level security;
alter table public.products disable row level security;
alter table public.product_addons disable row level security;
alter table public.cash_sessions disable row level security;
alter table public.orders disable row level security;
alter table public.order_items disable row level security;
alter table public.order_item_addons disable row level security;
alter table public.payments disable row level security;
alter table public.stock_movements disable row level security;
alter table public.legacy_sales_imports disable row level security;
alter table public.legacy_sales disable row level security;
alter table if exists public.legacy_product_sales_imports disable row level security;
alter table if exists public.legacy_product_sales disable row level security;
alter table if exists public.sync_queue disable row level security;
alter table if exists public.order_cancellations disable row level security;
alter table if exists public.product_availability_events disable row level security;
alter table public.audit_logs disable row level security;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

alter default privileges in schema public
grant select, insert, update, delete on tables to anon, authenticated;

alter default privileges in schema public
grant usage, select on sequences to anon, authenticated;



-- ============================================================================
-- SECTION: final compatibility grants and schema reload
-- ============================================================================

do $$
declare
  table_record record;
begin
  for table_record in
    select schemaname, tablename
    from pg_tables
    where schemaname = 'public'
  loop
    execute format('alter table if exists %I.%I disable row level security', table_record.schemaname, table_record.tablename);
  end loop;
end $$;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
grant execute on all functions in schema public to anon, authenticated;

alter default privileges in schema public
grant select, insert, update, delete on tables to anon, authenticated;

alter default privileges in schema public
grant usage, select on sequences to anon, authenticated;

alter default privileges in schema public
grant execute on functions to anon, authenticated;

notify pgrst, 'reload schema';

-- Done.
