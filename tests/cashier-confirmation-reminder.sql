-- Execute inside BEGIN/ROLLBACK. Never commit these synthetic orders or queued pushes.
do $$
declare
  v_id uuid := gen_random_uuid();
  v_categories text[];
begin
  insert into public.orders(id,order_number,source,type,status,payment_status,
    customer_order_type,customer_order_status,payment_provider,notification_categories)
  values(v_id,'QA-CONFIRM-'||v_id::text,'Self Order','Take Away','Pesanan Baru','Belum dibayar',
    'PICKUP_PREORDER','WAITING_ACCEPTANCE','cash_at_outlet',array['Coffee']);
  select notification_categories into v_categories from public.kasirin_order_notification_status(v_id);
  if v_categories is distinct from array['__confirmation__']::text[] then raise exception 'Pending pickup did not classify as confirmation'; end if;
  update public.orders set confirmed_at=now() where id=v_id;
  select notification_categories into v_categories from public.kasirin_order_notification_status(v_id);
  if v_categories is distinct from array['Coffee']::text[] then raise exception 'Acceptance did not stop confirmation reminders'; end if;
  update public.orders set confirmed_at=null,type='Delivery',customer_order_type='DELIVERY',
    customer_order_status='SEARCHING_DRIVER',payment_provider='courier_cash' where id=v_id;
  select notification_categories into v_categories from public.kasirin_order_notification_status(v_id);
  if '__confirmation__'=any(v_categories) then raise exception 'Unprocessed delivery offer was classified as cashier confirmation'; end if;
  update public.orders set type='Take Away',customer_order_type='',customer_order_status='',payment_provider='' where id=v_id;
  select notification_categories into v_categories from public.kasirin_order_notification_status(v_id);
  if v_categories is distinct from array['__confirmation__']::text[] then raise exception 'Outlet takeaway did not classify as confirmation'; end if;
  update public.orders set status='Dibatalkan',cancelled_at=now() where id=v_id;
  select notification_categories into v_categories from public.kasirin_order_notification_status(v_id);
  if '__confirmation__'=any(v_categories) then raise exception 'Cancelled order still classified as confirmation'; end if;
end;
$$;
select 'Cashier confirmation reminder regression passed' as result;
