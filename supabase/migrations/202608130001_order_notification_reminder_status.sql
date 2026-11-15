-- Read-only status endpoint used by the Android reminder receiver while the
-- WebView is closed. It exposes only one status value, not the order record.
drop function if exists public.kasirin_order_notification_status(uuid);

create or replace function public.kasirin_order_notification_status(p_order_id uuid)
returns table(status text)
language sql
stable
security definer
set search_path = public
as $$
  select orders.status::text
  from public.orders
  where orders.id = p_order_id
  limit 1;
$$;

revoke all on function public.kasirin_order_notification_status(uuid) from public;
grant execute on function public.kasirin_order_notification_status(uuid) to anon, authenticated;
