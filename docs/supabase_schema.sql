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
