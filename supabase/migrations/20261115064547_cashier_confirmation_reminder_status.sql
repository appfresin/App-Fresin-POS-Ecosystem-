-- Keep the existing two-field reminder API and permissions. Confirmation alerts
-- stop repeating when the cashier accepts, even while kitchen status is still new.
create or replace function public.kasirin_order_notification_status(p_order_id uuid)
returns table(status text, notification_categories text[])
language sql stable security definer set search_path = '' as $$
  select o.status::text,
    case when lower(coalesce(o.status::text,'')) = 'pesanan baru'
      and o.confirmed_at is null and o.cancelled_at is null and o.prepared_at is null and o.ready_at is null
      and coalesce(o.customer_order_status,'') not in ('SCHEDULED','SEARCHING_DRIVER','NO_DRIVER_AVAILABLE','CANCELLED','COMPLETED')
      and (
        ((o.customer_order_type = 'DELIVERY' or o.type::text = 'Delivery')
          and nullif(o.driver_id,'') is not null
          and o.customer_order_status in ('WAITING_ACCEPTANCE','WAITING_CASHIER','WAITING_CONFIRMATION'))
        or ((o.customer_order_type in ('PICKUP_PREORDER','TAKEAWAY')
              or (o.type::text = 'Take Away' and lower(coalesce(o.source,'')) = 'self order'))
          and (coalesce(o.customer_order_type,'') <> 'DELIVERY' and o.type::text <> 'Delivery')
          and (coalesce(o.customer_order_type,'') <> 'PICKUP_PREORDER'
            or coalesce(o.payment_provider,'') in ('','cash_at_outlet') or o.payment_status::text = 'Lunas'))
      ) then array['__confirmation__']::text[]
      else coalesce(o.notification_categories,'{}'::text[])
    end
  from public.orders o where o.id = p_order_id limit 1;
$$;
