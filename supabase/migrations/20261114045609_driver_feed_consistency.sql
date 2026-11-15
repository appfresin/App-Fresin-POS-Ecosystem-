-- Staff-authenticated feed: identical data visibility in browser and WebView.
-- Prerequisite: 20261114011051_driver_native_notifications.sql. No changes applied remotely.
begin;
create or replace function public.register_driver_push_device(
  p_device_id uuid, p_secret text, p_token text, p_enabled boolean,
  p_login text default null, p_pin text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_device public.driver_push_devices%rowtype; v_driver text;
begin
  if p_device_id is null or p_secret is null or p_secret !~ '^[a-f0-9]{64}$'
    or length(coalesce(p_token,'')) > 4096 or (coalesce(p_token,'') <> '' and length(p_token) < 32) then
    raise exception 'Invalid device registration' using errcode='22023';
  end if;
  select * into v_device from public.driver_push_devices where id=p_device_id for update;
  if coalesce(p_login,'')<>'' and coalesce(p_pin,'')<>'' then
    select driver_id into v_driver from public.authenticate_driver_staff(p_login,p_pin) limit 1;
    if v_driver is null or (v_device.id is not null and v_device.driver_id<>v_driver) then raise exception 'Driver authentication required' using errcode='28000'; end if;
  elsif v_device.id is not null and v_device.secret_hash=encode(extensions.digest(p_secret,'sha256'),'hex') and v_device.expires_at>now() then
    v_driver:=v_device.driver_id;
  else
    select driver_id into v_driver from public.authenticate_driver_staff(p_login,p_pin) limit 1;
    if v_driver is null or (v_device.id is not null and v_device.driver_id<>v_driver) then
      raise exception 'Driver authentication required' using errcode='28000';
    end if;
  end if;
  if not public.driver_push_staff_active(v_driver) then raise exception 'Driver access revoked' using errcode='28000'; end if;
  insert into public.driver_push_devices(id,driver_id,secret_hash,fcm_token,enabled,expires_at,updated_at)
    values(p_device_id,v_driver,encode(extensions.digest(p_secret,'sha256'),'hex'),coalesce(nullif(p_token,''),v_device.fcm_token,''),coalesce(p_enabled,false) and length(coalesce(nullif(p_token,''),v_device.fcm_token,''))>=32,now()+interval '30 days',now())
    on conflict(id) do update set secret_hash=excluded.secret_hash,fcm_token=excluded.fcm_token,enabled=excluded.enabled,expires_at=excluded.expires_at,updated_at=excluded.updated_at;
  if length(coalesce(p_token,''))>=32 then update public.driver_push_devices set enabled=false where fcm_token=p_token and id<>p_device_id; end if;
  return jsonb_build_object('ok',true);
end;
$$;
revoke all on function public.register_driver_push_device(uuid,text,text,boolean,text,text) from public;
grant execute on function public.register_driver_push_device(uuid,text,text,boolean,text,text) to anon,authenticated;


create or replace function public.driver_order_feed(p_device_id uuid,p_secret text,p_from timestamptz,p_to timestamptz)
returns setof jsonb language plpgsql security definer set search_path = '' as $$
declare v_driver text; v_today timestamptz:=date_trunc('day',now() at time zone 'Asia/Jakarta') at time zone 'Asia/Jakarta';
begin
  if p_secret is null or p_secret !~ '^[a-f0-9]{64}$' then raise exception 'Driver authentication required' using errcode='28000'; end if;
  select driver_id into v_driver from public.driver_push_devices where id=p_device_id and expires_at>now()
    and secret_hash=encode(extensions.digest(p_secret,'sha256'),'hex');
  if v_driver is null or not public.driver_push_staff_active(v_driver) then raise exception 'Driver authentication required' using errcode='28000'; end if;
  if p_from is null or p_to is null or p_to<=p_from or p_to-p_from>interval '366 days' then raise exception 'Invalid date range' using errcode='22023'; end if;
  return query
  select (select jsonb_object_agg(k,v) from jsonb_each(to_jsonb(o)) item(k,v) where k=any(ARRAY['id','order_number','source','type','customer_name','customer_phone','service_info','note','status','payment_status','payment_provider','customer_order_type','customer_order_status','subtotal','delivery_fee','grand_total','created_at','updated_at','confirmed_at','cancelled_at','cancel_reason','ready_at','completed_at','delivery_address','delivery_note','delivery_location','delivery_latitude','delivery_longitude','driver_id','driver_name','driver_phone']))
  from public.orders o
  where o.customer_order_type='DELIVERY' and (
    (o.driver_id::text=v_driver and coalesce(o.customer_order_status,'') in ('DRIVER_ASSIGNED','PREPARING','READY_FOR_PICKUP','PICKED_UP','DELIVERING'))
    or (nullif(o.driver_id::text,'') is null and nullif(o.driver_name,'') is null and nullif(o.driver_phone,'') is null
      and o.customer_order_status='SEARCHING_DRIVER' and o.cancelled_at is null and coalesce(o.status::text,'') not in ('Batal','Dibatalkan')
      and coalesce(o.updated_at,o.created_at)>now()-interval '5 minutes')
    or ((o.driver_id::text=v_driver or (nullif(o.driver_id::text,'') is null and nullif(o.driver_name,'') is null and nullif(o.driver_phone,'') is null))
      and coalesce(o.cancelled_at,o.updated_at,o.created_at)>=v_today
      and (o.cancelled_at is not null or o.status::text in ('Batal','Dibatalkan') or o.customer_order_status in ('CANCELLED','NO_DRIVER_AVAILABLE')))
    or (o.driver_id::text=v_driver and o.customer_order_status='COMPLETED' and o.payment_status::text='Lunas'
      and coalesce(o.completed_at,o.updated_at)>=p_from and coalesce(o.completed_at,o.updated_at)<p_to)
  ) and (coalesce(o.payment_provider,'')='courier_cash' or o.payment_status::text='Lunas' or o.customer_order_status='SEARCHING_DRIVER')
  order by case when o.driver_id::text=v_driver and coalesce(o.customer_order_status,'') not in ('COMPLETED','CANCELLED','NO_DRIVER_AVAILABLE') then 0
    when o.customer_order_status='SEARCHING_DRIVER' then 1 when o.customer_order_status='COMPLETED' then 3 else 2 end,
    o.updated_at desc nulls last, o.id
  limit 1000;
end;
$$;
revoke all on function public.driver_order_feed(uuid,text,timestamptz,timestamptz) from public;
grant execute on function public.driver_order_feed(uuid,text,timestamptz,timestamptz) to anon,authenticated;
-- Preserve any live custom notification implementation; add only the release gate.
do $driver_release$
declare definition text;
begin
  if to_regprocedure('public.kasirin_notify_cash_order_push()') is null then
    raise exception 'Cash order notification prerequisite is missing';
  end if;
  select pg_get_functiondef('public.kasirin_notify_cash_order_push()'::regprocedure) into definition;
  if position('DRIVER_PROCESS_RELEASE_GATE' in definition)=0 then
    definition:=regexp_replace(definition,'(?in)^begin[[:space:]]*$',
      E'begin\n  -- DRIVER_PROCESS_RELEASE_GATE\n  if coalesce(new.customer_order_type, '''') = ''DELIVERY'' and new.confirmed_at is null then return new; end if;');
    if position('DRIVER_PROCESS_RELEASE_GATE' in definition)=0 then raise exception 'Cannot safely locate cash push entry point'; end if;
    execute definition;
  end if;
end;
$driver_release$;
notify pgrst,'reload schema';
commit;
