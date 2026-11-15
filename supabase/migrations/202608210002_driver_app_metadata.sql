-- Driver app metadata for customer-home delivery orders.
-- Additive and safe to rerun. This does not replace or alter push triggers.

begin;

alter table if exists public.orders
  add column if not exists driver_name text,
  add column if not exists driver_phone text;

create index if not exists idx_orders_driver_delivery_active
  on public.orders(customer_order_type, payment_status, customer_order_status, driver_id)
  where customer_order_type = 'DELIVERY';

create index if not exists idx_orders_driver_delivery_status
  on public.orders(customer_order_type, customer_order_status, updated_at desc)
  where customer_order_type = 'DELIVERY';

grant usage on schema public to anon, authenticated;
grant select on public.orders to anon, authenticated;
grant select on public.order_items to anon, authenticated;
grant select on public.order_item_addons to anon, authenticated;
grant update (customer_order_status, status, completed_at, updated_at, driver_id, driver_name, driver_phone)
  on public.orders to anon, authenticated;

drop policy if exists driver_delivery_orders_select on public.orders;
create policy driver_delivery_orders_select on public.orders
  for select
  using (
    customer_order_type = 'DELIVERY'
    and (
      coalesce(customer_order_status, '') in ('SEARCHING_DRIVER', 'DRIVER_ASSIGNED', 'PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP', 'DELIVERING')
      or (
        payment_status::text = 'Lunas'
        and coalesce(customer_order_status, '') = 'COMPLETED'
      )
    )
  );

drop policy if exists driver_delivery_orders_update on public.orders;
create policy driver_delivery_orders_update on public.orders
  for update
  using (
    customer_order_type = 'DELIVERY'
    and coalesce(customer_order_status, '') in ('SEARCHING_DRIVER', 'DRIVER_ASSIGNED', 'READY_FOR_PICKUP', 'PICKED_UP', 'DELIVERING')
  )
  with check (
    customer_order_type = 'DELIVERY'
    and (
      coalesce(customer_order_status, '') = 'DRIVER_ASSIGNED'
      or (
        payment_status::text = 'Lunas'
        and coalesce(customer_order_status, '') in ('READY_FOR_PICKUP', 'PICKED_UP', 'DELIVERING', 'COMPLETED')
      )
    )
  );

drop policy if exists driver_delivery_order_items_select on public.order_items;
create policy driver_delivery_order_items_select on public.order_items
  for select
  using (
    exists (
      select 1
      from public.orders o
      where o.id = order_items.order_id
        and o.customer_order_type = 'DELIVERY'
        and (
          coalesce(o.customer_order_status, '') in ('SEARCHING_DRIVER', 'DRIVER_ASSIGNED', 'PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP', 'DELIVERING')
          or (
            o.payment_status::text = 'Lunas'
            and coalesce(o.customer_order_status, '') = 'COMPLETED'
          )
        )
    )
  );

drop policy if exists driver_delivery_order_item_addons_select on public.order_item_addons;
create policy driver_delivery_order_item_addons_select on public.order_item_addons
  for select
  using (
    exists (
      select 1
      from public.order_items item
      join public.orders o on o.id = item.order_id
      where item.id = order_item_addons.order_item_id
        and o.customer_order_type = 'DELIVERY'
        and (
          coalesce(o.customer_order_status, '') in ('SEARCHING_DRIVER', 'DRIVER_ASSIGNED', 'PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP', 'DELIVERING')
          or (
            o.payment_status::text = 'Lunas'
            and coalesce(o.customer_order_status, '') = 'COMPLETED'
          )
        )
    )
  );

notify pgrst, 'reload schema';

commit;
