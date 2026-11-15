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
