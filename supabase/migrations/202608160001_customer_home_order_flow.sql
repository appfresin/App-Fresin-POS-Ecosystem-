-- Customer home ordering foundation for Pickup Preorder and Delivery.
-- Unpaid customer-home orders are stored but must not trigger kitchen/driver work.

alter table public.orders
  add column if not exists customer_order_type text,
  add column if not exists customer_order_status text,
  add column if not exists customer_phone text,
  add column if not exists pickup_time text,
  add column if not exists delivery_address text,
  add column if not exists delivery_note text,
  add column if not exists delivery_location text,
  add column if not exists delivery_latitude numeric(10,7),
  add column if not exists delivery_longitude numeric(10,7),
  add column if not exists payment_provider text,
  add column if not exists payment_reference text,
  add column if not exists public_order_token text,
  add column if not exists driver_id text;

create unique index if not exists idx_orders_public_order_token
  on public.orders(public_order_token)
  where public_order_token is not null and public_order_token <> '';

create index if not exists idx_orders_customer_home_status
  on public.orders(customer_order_type, customer_order_status, payment_status);

create or replace function public.kasirin_notify_order_push()
returns trigger
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  internal_secret text;
  event_type text;
  order_categories text[];
  request_id bigint;
begin
  if coalesce(new.customer_order_type, '') in ('PICKUP_PREORDER', 'DELIVERY')
    and coalesce(new.payment_status::text, '') <> 'Lunas' then
    return new;
  end if;

  if coalesce(new.customer_order_status, '') in ('SCHEDULED', 'SEARCHING_DRIVER', 'NO_DRIVER_AVAILABLE')
    and not (
      tg_op = 'UPDATE'
      and coalesce(new.customer_order_type, '') = 'DELIVERY'
      and coalesce(old.payment_status::text, '') <> 'Lunas'
      and coalesce(new.payment_status::text, '') = 'Lunas'
    ) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    event_type := 'new_order';
  elsif tg_op = 'UPDATE' then
    if coalesce(new.customer_order_type, '') in ('PICKUP_PREORDER', 'DELIVERY')
      and coalesce(old.payment_status::text, '') <> 'Lunas'
      and coalesce(new.payment_status::text, '') = 'Lunas'
      and (
        coalesce(new.customer_order_type, '') = 'DELIVERY'
        or coalesce(new.customer_order_status, '') not in ('SCHEDULED', 'SEARCHING_DRIVER', 'NO_DRIVER_AVAILABLE')
      ) then
      event_type := 'new_order';
    elsif coalesce(new.payment_status::text, '') <> coalesce(old.payment_status::text, '')
      and coalesce(new.payment_status::text, '') = 'Lunas' then
      event_type := 'payment_paid';
    elsif coalesce(new.status::text, '') <> coalesce(old.status::text, '') then
      event_type := 'status_changed';
    elsif coalesce(new.updated_at, new.created_at) <> coalesce(old.updated_at, old.created_at) then
      event_type := 'additional_order';
    else
      return new;
    end if;
  end if;

  if coalesce(new.status::text, '') in ('Dibatalkan', 'Selesai') then
    return new;
  end if;

  if event_type not in ('new_order', 'additional_order') then
    return new;
  end if;

  order_categories := coalesce(new.notification_categories, '{}'::text[]);

  select decrypted_secret
    into internal_secret
  from vault.decrypted_secrets
  where name = 'kasirin_push_internal_secret'
  limit 1;

  if nullif(internal_secret, '') is null then
    raise warning 'kasirin_push_internal_secret is not configured';
    return new;
  end if;

  select net.http_post(
    url := 'https://pjkotqianxecaawqompo.supabase.co/functions/v1/notify-new-order',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-kasirin-push-secret', internal_secret
    ),
    body := jsonb_build_object(
      'internal', true,
      'target', 'all',
      'tone', 'alert',
      'orderId', new.id,
      'orderNumber', new.order_number,
      'eventType', event_type,
      'source', new.source,
      'orderType', new.type::text,
      'customerOrderType', coalesce(new.customer_order_type, ''),
      'customerOrderStatus', coalesce(new.customer_order_status, ''),
      'table', coalesce(nullif(new.table_label, ''), nullif(new.service_info, ''), ''),
      'customerName', coalesce(new.customer_name, ''),
      'grandTotal', coalesce(new.grand_total, 0),
      'orderCategories', order_categories
    ),
    timeout_milliseconds := 15000
  ) into request_id;

  return new;
exception
  when others then
    raise warning 'kasirin_notify_order_push failed: %', sqlerrm;
    return new;
end;
$$;

drop trigger if exists trg_kasirin_notify_order_push on public.orders;
create trigger trg_kasirin_notify_order_push
  after insert or update on public.orders
  for each row
  execute function public.kasirin_notify_order_push();

notify pgrst, 'reload schema';
