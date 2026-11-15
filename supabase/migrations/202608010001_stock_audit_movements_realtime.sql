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
