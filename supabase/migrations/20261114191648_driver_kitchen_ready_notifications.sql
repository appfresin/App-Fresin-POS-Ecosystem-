begin;
-- Independent of the existing offer/reminder trigger. Payment alone cannot emit a ready alert.
create or replace function public.kasirin_notify_driver_ready_push()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_ready boolean;
  v_was_ready boolean;
  v_event text;
  v_secret text;
begin
  if coalesce(new.customer_order_type,'')<>'DELIVERY' then return new; end if;
  v_ready:=nullif(new.driver_id::text,'') is not null and new.cancelled_at is null
    and coalesce(new.status::text,'') not in ('Dibatalkan','Batal')
    and coalesce(new.customer_order_status,'') not in ('PICKED_UP','DELIVERING','COMPLETED','CANCELLED','NO_DRIVER_AVAILABLE')
    and (new.ready_at is not null or coalesce(new.status::text,'') in ('Selesai','Siap diambil'));
  v_was_ready:=nullif(old.driver_id::text,'') is not null and old.cancelled_at is null
    and coalesce(old.status::text,'') not in ('Dibatalkan','Batal')
    and coalesce(old.customer_order_status,'') not in ('PICKED_UP','DELIVERING','COMPLETED','CANCELLED','NO_DRIVER_AVAILABLE')
    and (old.ready_at is not null or coalesce(old.status::text,'') in ('Selesai','Siap diambil'));
  if v_ready and (not v_was_ready or new.driver_id is distinct from old.driver_id) then v_event:='driver_ready';
  elsif v_was_ready and not v_ready then v_event:='driver_ready_clear';
  else return new;
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name='kasirin_push_internal_secret' limit 1;
  if nullif(v_secret,'') is null then raise warning 'Driver push secret not configured'; return new; end if;
  perform net.http_post(
    url:='https://pjkotqianxecaawqompo.supabase.co/functions/v1/notify-new-order',
    headers:=jsonb_build_object('Content-Type','application/json','x-kasirin-push-secret',v_secret),
    body:=jsonb_build_object('target','driver','eventType',v_event,'orderId',new.id,'revisionAt',coalesce(new.updated_at,new.created_at)),
    timeout_milliseconds:=15000);
  return new;
exception when others then
  raise warning 'Driver ready push enqueue failed: %',sqlerrm;
  return new;
end;
$$;
revoke all on function public.kasirin_notify_driver_ready_push() from public,anon,authenticated;
drop trigger if exists trg_kasirin_notify_driver_ready_push on public.orders;
create trigger trg_kasirin_notify_driver_ready_push after update on public.orders
  for each row execute function public.kasirin_notify_driver_ready_push();
commit;
