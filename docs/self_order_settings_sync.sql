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
