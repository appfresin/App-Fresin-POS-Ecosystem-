-- Synthetic fixtures and outbound queue entries are rolled back; no pushes are sent.
begin;
do $$
declare
  v_id uuid:=gen_random_uuid();
  v_events jsonb;
begin
  insert into public.orders(id,order_number,customer_name,type,customer_order_type,payment_provider,
    customer_order_status,driver_id,confirmed_at,status)
  values(v_id,'QA-READY-'||v_id,'Rollback QA','Delivery','DELIVERY','courier_cash',
    'PREPARING','qa-driver',now(),'Sedang Disiapkan');
  update public.orders set payment_status='Lunas' where id=v_id;
  if exists(select 1 from net.http_request_queue where convert_from(body,'UTF8')::jsonb->>'orderId'=v_id::text
    and convert_from(body,'UTF8')::jsonb->>'eventType'='driver_ready') then raise exception 'Payment emitted a kitchen-ready event'; end if;
  update public.orders set status='Selesai',completed_at=now() where id=v_id;
  if (select count(*) from net.http_request_queue where convert_from(body,'UTF8')::jsonb->>'orderId'=v_id::text
    and convert_from(body,'UTF8')::jsonb->>'eventType'='driver_ready')<>1 then raise exception 'Kitchen completion did not emit exactly one ready event'; end if;
  update public.orders set payment_status='Lunas' where id=v_id;
  if (select count(*) from net.http_request_queue where convert_from(body,'UTF8')::jsonb->>'orderId'=v_id::text
    and convert_from(body,'UTF8')::jsonb->>'eventType'='driver_ready')<>1 then raise exception 'Payment duplicated the ready event'; end if;
  update public.orders set customer_order_status='DELIVERING' where id=v_id;
  if (select count(*) from net.http_request_queue where convert_from(body,'UTF8')::jsonb->>'orderId'=v_id::text
    and convert_from(body,'UTF8')::jsonb->>'eventType'='driver_ready_clear')<>1 then raise exception 'Delivery did not clear ready alert'; end if;
end;
$$;
select 'PASS: payment emits no ready alert; kitchen completion emits one; repeat payment does not duplicate; delivery clears' as result;
rollback;
