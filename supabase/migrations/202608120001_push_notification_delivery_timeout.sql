-- Keep the database request alive while the Edge Function waits briefly for
-- order_items to be available for kitchen category filtering.
create or replace function public.kasirin_notify_order_push()
returns trigger
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  internal_secret text;
  event_type text;
  request_id bigint;
begin
  if tg_op = 'INSERT' then
    event_type := 'new_order';
  elsif tg_op = 'UPDATE' then
    if coalesce(new.grand_total, 0) <= coalesce(old.grand_total, 0)
      and coalesce(new.subtotal, 0) <= coalesce(old.subtotal, 0) then
      return new;
    end if;
    if coalesce(new.payment_status::text, '') <> coalesce(old.payment_status::text, '')
      and coalesce(new.grand_total, 0) = coalesce(old.grand_total, 0)
      and coalesce(new.subtotal, 0) = coalesce(old.subtotal, 0) then
      return new;
    end if;
    event_type := 'additional_order';
  else
    return new;
  end if;

  if coalesce(new.status::text, '') in ('Dibatalkan', 'Selesai') then
    return new;
  end if;

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
      'eventType', event_type,
      'orderId', new.id,
      'orderNumber', coalesce(new.order_number, ''),
      'source', coalesce(new.source, ''),
      'table', coalesce(nullif(new.table_label, ''), nullif(new.service_info, ''), ''),
      'customer', coalesce(new.customer_name, ''),
      'scopeKey', 'outlet-utama',
      'target', 'all',
      'tone', 'alert'
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
