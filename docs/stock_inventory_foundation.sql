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
