-- Lightweight product sales aggregate for the Barang report.
-- Safe to rerun. It reads paid operational orders and returns one row per day/product.

begin;

drop view if exists public.report_product_sales_daily cascade;

create or replace view public.report_product_sales_daily as
with latest_payments as (
  select distinct on (p.order_id)
    p.order_id,
    p.paid_at
  from public.payments p
  order by p.order_id, p.paid_at desc
),
paid_orders as (
  select
    o.id,
    (coalesce(lp.paid_at, o.created_at) at time zone 'Asia/Jakarta')::date as sales_date
  from public.orders o
  left join latest_payments lp on lp.order_id = o.id
  where o.payment_status::text = 'Lunas'
    and coalesce(o.status::text, '') <> 'Dibatalkan'
    and (
      o.status::text = 'Selesai'
      or lower(coalesce(o.source, '')) like '%kasir%'
      or lower(coalesce(o.source, '')) like '%pos%'
    )
),
item_sales as (
  select
    po.sales_date,
    coalesce(nullif(item.sku, ''), nullif(item.product_id::text, ''), lower(coalesce(item.product_name, 'Item'))) as code,
    coalesce(item.product_name, 'Item') as name,
    count(*)::int as transaction_count,
    coalesce(sum(item.qty), 0)::numeric(14,2) as qty,
    coalesce(sum(greatest(0, (item.price * item.qty) - coalesce(item.discount, 0))), 0)::numeric(14,2) as revenue,
    coalesce(sum(greatest(0, ((item.price - coalesce(item.cost, 0)) * item.qty) - coalesce(item.discount, 0))), 0)::numeric(14,2) as profit
  from paid_orders po
  join public.order_items item on item.order_id = po.id
  group by
    po.sales_date,
    coalesce(nullif(item.sku, ''), nullif(item.product_id::text, ''), lower(coalesce(item.product_name, 'Item'))),
    coalesce(item.product_name, 'Item')
),
addon_sales as (
  select
    po.sales_date,
    coalesce(nullif(addon.addon_id::text, ''), lower(coalesce(addon.addon_name, 'Tambahan'))) as code,
    coalesce(addon.addon_name, 'Tambahan') as name,
    count(*)::int as transaction_count,
    coalesce(sum(addon.qty), 0)::numeric(14,2) as qty,
    coalesce(sum(addon.price * addon.qty), 0)::numeric(14,2) as revenue,
    coalesce(sum((addon.price - coalesce(addon.cost, 0)) * addon.qty), 0)::numeric(14,2) as profit
  from paid_orders po
  join public.order_items item on item.order_id = po.id
  join public.order_item_addons addon on addon.order_item_id = item.id
  group by
    po.sales_date,
    coalesce(nullif(addon.addon_id::text, ''), lower(coalesce(addon.addon_name, 'Tambahan'))),
    coalesce(addon.addon_name, 'Tambahan')
)
select
  sales_date,
  code,
  name,
  sum(transaction_count)::int as transaction_count,
  sum(qty)::numeric(14,2) as qty,
  sum(revenue)::numeric(14,2) as revenue,
  sum(profit)::numeric(14,2) as profit,
  'Supabase Ringkasan Barang'::text as source
from (
  select * from item_sales
  union all
  select * from addon_sales
) product_rows
group by
  sales_date,
  code,
  name;

grant usage on schema public to anon;
grant select on public.report_product_sales_daily to anon;

commit;
