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
