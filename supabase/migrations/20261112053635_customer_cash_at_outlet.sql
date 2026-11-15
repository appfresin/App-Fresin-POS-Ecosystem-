-- Cash pickup: customer pays products at the outlet.
-- Cash delivery: driver pays products at the outlet and keeps the delivery fee.
-- No existing prepaid order is converted by this migration.
begin;

-- Preserve the deployed legacy notification implementation for prepaid orders.
-- Cash orders have a separate trigger below, including cashier acceptance.
do $patch$
declare definition text;
begin
  select pg_get_functiondef('public.kasirin_notify_order_push()'::regprocedure) into definition;
  if position('CASH_ORDER_NOTIFICATION_DELEGATED' in definition) = 0 then
    definition := regexp_replace(definition, '(?in)^begin[[:space:]]*$',
      E'begin\n  -- CASH_ORDER_NOTIFICATION_DELEGATED\n  if coalesce(new.payment_provider, '''') in (''cash_at_outlet'', ''courier_cash'') then return new; end if;');
    if position('CASH_ORDER_NOTIFICATION_DELEGATED' in definition) = 0 then
      raise exception 'Cannot safely locate notification function entry point';
    end if;
    execute definition;
  end if;
end;
$patch$;

create or replace function public.kasirin_notify_cash_order_push()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, vault, net
as $$
declare internal_secret text; event_type text; target_role text; request_id bigint;
begin
  if coalesce(new.payment_provider, '') not in ('cash_at_outlet', 'courier_cash')
    or coalesce(new.customer_order_type, '') not in ('PICKUP_PREORDER', 'DELIVERY')
    or coalesce(new.status::text, '') in ('Dibatalkan', 'Selesai') then return new; end if;
  if new.customer_order_type = 'DELIVERY' and nullif(new.driver_id, '') is null then return new; end if;

  if tg_op = 'INSERT' then event_type := 'new_order';
  elsif tg_op = 'UPDATE' then
    if (old.confirmed_at is null and new.confirmed_at is not null)
      or (nullif(old.driver_id, '') is null and nullif(new.driver_id, '') is not null) then event_type := 'new_order';
    elsif coalesce(new.subtotal, 0) > coalesce(old.subtotal, 0) then event_type := 'additional_order';
    else return new; end if;
  else return new; end if;

  target_role := case when new.confirmed_at is null then 'kasir' else 'all' end;
  select decrypted_secret into internal_secret from vault.decrypted_secrets
    where name = 'kasirin_push_internal_secret' limit 1;
  if nullif(internal_secret, '') is null then return new; end if;
  select net.http_post(
    url := 'https://pjkotqianxecaawqompo.supabase.co/functions/v1/notify-new-order',
    headers := jsonb_build_object('Content-Type','application/json','x-kasirin-push-secret',internal_secret),
    body := jsonb_build_object('internal',true,'eventType',event_type,'orderId',new.id,
      'orderNumber',new.order_number,'source',new.source,'customer',coalesce(new.customer_name,''),
      'scopeKey','outlet-utama','target',target_role,'tone','alert',
      'orderCategories',coalesce(new.notification_categories,'{}'::text[])),
    timeout_milliseconds := 15000
  ) into request_id;
  return new;
exception when others then
  raise warning 'Cash order notification failed: %', sqlerrm;
  return new;
end;
$$;
revoke all on function public.kasirin_notify_cash_order_push() from public;
drop trigger if exists trg_kasirin_notify_cash_order_push on public.orders;
create trigger trg_kasirin_notify_cash_order_push after insert or update on public.orders
for each row execute function public.kasirin_notify_cash_order_push();

create or replace function public.guard_customer_cash_order_progress()
returns trigger language plpgsql security invoker set search_path = pg_catalog
as $$
begin
  if coalesce(new.payment_provider, '') not in ('cash_at_outlet','courier_cash') then return new; end if;
  if new.payment_provider = 'courier_cash'
    and coalesce(new.customer_order_status,'') in ('PICKED_UP','DELIVERING','COMPLETED')
    and coalesce(new.payment_status::text,'') <> 'Lunas' then
    raise exception using errcode = '23514', message = 'Kasir harus mencatat pembayaran produk oleh kurir sebelum pesanan dibawa.';
  end if;
  if coalesce(new.customer_order_status,'') = 'PAYMENT_EXPIRED' then
    raise exception using errcode = '23514', message = 'Pesanan bayar di tempat tidak memiliki batas pembayaran online.';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_customer_cash_order_progress() from public;
drop trigger if exists trg_guard_customer_cash_order_progress on public.orders;
create trigger trg_guard_customer_cash_order_progress before insert or update on public.orders
for each row execute function public.guard_customer_cash_order_progress();

-- Keep the customer's grand_total (products + delivery) while recording only
-- outlet revenue in the existing report view and its dependent summaries.
do $reports$
declare definition text;
begin
  if to_regclass('public.report_sales_records') is null then
    raise exception 'report_sales_records must exist before installing cash delivery';
  end if;
  select pg_get_viewdef('public.report_sales_records'::regclass, true) into definition;
  if position('courier_cash' in definition) = 0 then
    if definition !~ 'FROM (public\.)?orders o' or definition !~ '\mgrand_total\M' then
      raise exception 'Cannot safely locate the outlet revenue expression';
    end if;
    definition := regexp_replace(definition, '(^|[^[:alnum:]_.])(?:o\.)?grand_total\M',
      '\1(case when o.payment_provider = ''courier_cash'' then greatest(0, coalesce(o.grand_total,0) - coalesce(o.delivery_fee,0)) else o.grand_total end)', 'g');
    execute 'create or replace view public.report_sales_records as ' || definition;
  end if;
end;
$reports$;

notify pgrst, 'reload schema';
commit;
