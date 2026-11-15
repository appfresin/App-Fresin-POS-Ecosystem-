-- Midtrans QRIS payment metadata for customer-home orders.
-- Safe to rerun.

begin;

alter table if exists public.orders
  add column if not exists payment_gateway_transaction_id text,
  add column if not exists payment_gateway_status text,
  add column if not exists payment_qr_url text,
  add column if not exists payment_expiry_time timestamptz,
  add column if not exists payment_gateway_payload jsonb not null default '{}'::jsonb;

create index if not exists idx_orders_payment_reference
  on public.orders(payment_reference)
  where payment_reference is not null and payment_reference <> '';

notify pgrst, 'reload schema';

commit;
