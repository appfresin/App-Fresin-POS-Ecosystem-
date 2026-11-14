begin;
-- Device capabilities are minted only after staff PIN verification. Never trust the
-- driver id/name supplied by the browser when authorizing a cancellation.
create or replace function public.driver_reject_order(
  p_device_id uuid, p_secret text, p_order_id uuid, p_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_driver text;
  v_order public.orders%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''), E' \t\n\r');
begin
  if p_secret is null or p_secret !~ '^[a-f0-9]{64}$' then
    raise exception 'Driver authentication required' using errcode='28000';
  end if;
  select driver_id into v_driver from public.driver_push_devices
  where id=p_device_id and expires_at>now()
    and secret_hash=encode(extensions.digest(p_secret,'sha256'),'hex');
  if v_driver is null or not public.driver_push_staff_active(v_driver) then
    raise exception 'Driver authentication required' using errcode='28000';
  end if;
  if length(v_reason) not between 1 and 500 then
    raise exception 'Rejection reason required (maximum 500 characters)' using errcode='22023';
  end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if not found or coalesce(v_order.customer_order_type,'')<>'DELIVERY'
    or coalesce(v_order.payment_provider,'')<>'courier_cash'
    or coalesce(v_order.payment_status::text,'')='Lunas'
    or v_order.cancelled_at is not null or v_order.confirmed_at is not null
    or coalesce(v_order.status::text,'')<>'Pesanan Baru'
    or not coalesce((
      (v_order.customer_order_status='DRIVER_ASSIGNED' and v_order.driver_id::text=v_driver)
      or (v_order.customer_order_status='SEARCHING_DRIVER'
        and nullif(v_order.driver_id::text,'') is null
        and nullif(v_order.driver_name,'') is null and nullif(v_order.driver_phone,'') is null
        and coalesce(v_order.updated_at,v_order.created_at)>now()-interval '5 minutes')
    ), false) then
    raise exception 'Order no longer eligible for driver rejection' using errcode='55000';
  end if;
  update public.orders set customer_order_status='CANCELLED', status='Dibatalkan',
    cancel_reason=v_reason, cancelled_at=now(), updated_at=now(), driver_id=v_driver
  where id=p_order_id returning * into v_order;
  return jsonb_build_object('id',v_order.id,'customer_order_status',v_order.customer_order_status,
    'status',v_order.status,'cancel_reason',v_order.cancel_reason,'cancelled_at',v_order.cancelled_at,
    'updated_at',v_order.updated_at,'driver_id',v_order.driver_id);
end;
$$;
revoke all on function public.driver_reject_order(uuid,text,uuid,text) from public;
grant execute on function public.driver_reject_order(uuid,text,uuid,text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
