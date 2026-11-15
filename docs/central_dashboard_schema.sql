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
