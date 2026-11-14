-- All fixtures, trigger enqueues, and device capabilities are rolled back.
begin;
do $$
declare
  v_driver text;
  v_device uuid:=gen_random_uuid();
  v_secret text:=encode(extensions.gen_random_bytes(32),'hex');
  v_own uuid:=gen_random_uuid();
  v_offer uuid:=gen_random_uuid();
  v_other uuid:=gen_random_uuid();
  v_paid uuid:=gen_random_uuid();
  v_prepared uuid:=gen_random_uuid();
  v_expired uuid:=gen_random_uuid();
  v_unknown uuid:=gen_random_uuid();
  v_result jsonb;
  v_id uuid;
begin
  select m->>'id' into v_driver
  from (select self_order_settings from public.store_settings order by updated_at desc nulls last limit 1) s,
    lateral jsonb_array_elements(coalesce(s.self_order_settings->'staff'->'members','[]'::jsonb)) m
  where public.driver_push_staff_active(m->>'id') limit 1;
  if v_driver is null then raise exception 'No active staff available for rollback-only QA'; end if;
  insert into public.driver_push_devices(id,driver_id,secret_hash,fcm_token,enabled,expires_at)
    values(v_device,v_driver,encode(extensions.digest(v_secret,'sha256'),'hex'),'',false,now()+interval '1 hour');
  insert into public.orders(id,order_number,customer_name,type,customer_order_type,payment_provider,
    customer_order_status,driver_id,payment_status,confirmed_at,updated_at)
  values
    (v_own,'QA-REJECT-'||v_own,'Rollback QA','Delivery','DELIVERY','courier_cash','DRIVER_ASSIGNED',v_driver,'Belum dibayar',null,now()),
    (v_offer,'QA-REJECT-'||v_offer,'Rollback QA','Delivery','DELIVERY','courier_cash','SEARCHING_DRIVER',null,'Belum dibayar',null,now()),
    (v_other,'QA-REJECT-'||v_other,'Rollback QA','Delivery','DELIVERY','courier_cash','DRIVER_ASSIGNED','qa-other-driver','Belum dibayar',null,now()),
    (v_paid,'QA-REJECT-'||v_paid,'Rollback QA','Delivery','DELIVERY','courier_cash','DRIVER_ASSIGNED',v_driver,'Lunas',null,now()),
    (v_prepared,'QA-REJECT-'||v_prepared,'Rollback QA','Delivery','DELIVERY','courier_cash','DRIVER_ASSIGNED',v_driver,'Belum dibayar',now(),now()),
    (v_expired,'QA-REJECT-'||v_expired,'Rollback QA','Delivery','DELIVERY','courier_cash','SEARCHING_DRIVER',null,'Belum dibayar',null,now()-interval '10 minutes'),
    (v_unknown,'QA-REJECT-'||v_unknown,'Rollback QA','Delivery','DELIVERY','courier_cash',null,null,'Belum dibayar',null,now());
  set local role anon;
  begin
    perform public.driver_reject_order(v_device,repeat('0',64),v_own,'Tidak tersedia');
    raise exception 'Invalid capability accepted';
  exception when sqlstate '28000' then null;
  end;
  begin
    perform public.driver_reject_order(v_device,v_secret,v_own,E' \n\t');
    raise exception 'Blank reason accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.driver_reject_order(v_device,v_secret,v_own,repeat('a',501));
    raise exception 'Oversized reason accepted';
  exception when sqlstate '22023' then null;
  end;
  foreach v_id in array array[v_other,v_paid,v_prepared,v_expired,v_unknown] loop
    begin
      perform public.driver_reject_order(v_device,v_secret,v_id,'Tidak tersedia');
      raise exception 'Ineligible order accepted: %',v_id;
    exception when sqlstate '55000' then null;
    end;
  end loop;
  v_result:=public.driver_reject_order(v_device,v_secret,v_own,'  Ban bocor  ');
  if v_result->>'customer_order_status'<>'CANCELLED' or v_result->>'cancel_reason'<>'Ban bocor' then
    raise exception 'Rejection reason/status lost';
  end if;
  begin
    perform public.driver_reject_order(v_device,v_secret,v_own,'Ulang');
    raise exception 'Duplicate rejection accepted';
  exception when sqlstate '55000' then null;
  end;
  v_result:=public.driver_reject_order(v_device,v_secret,v_offer,'Driver tidak tersedia');
  if v_result->>'driver_id'<>v_driver then raise exception 'Unassigned rejection actor not recorded'; end if;
  reset role;
  if not exists(select 1 from public.orders where id=v_own and cancelled_at is not null
    and status='Dibatalkan' and cancel_reason='Ban bocor') then raise exception 'Order cancellation not persisted'; end if;
end;
$$;
select 'PASS: anonymous RPC validates device, ownership, reason, payment, kitchen release, expiry, null status and duplicate rejection; customer reason persisted' as result;
rollback;
