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
