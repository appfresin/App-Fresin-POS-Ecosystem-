-- Local preparation only. Apply with the matching notify-new-order function when publishing.
begin;
create extension if not exists pgcrypto with schema extensions;
create table if not exists public.driver_push_devices (
  id uuid primary key,
  driver_id text not null,
  secret_hash text not null,
  fcm_token text not null,
  enabled boolean not null default true,
  expires_at timestamptz not null default now() + interval '30 days',
  updated_at timestamptz not null default now()
);
alter table public.driver_push_devices enable row level security;
revoke all on public.driver_push_devices from anon, authenticated;
grant all on public.driver_push_devices to service_role;
create index if not exists driver_push_devices_active on public.driver_push_devices(enabled, expires_at);

-- Re-check staff access even when an already registered device renews its token.
create or replace function public.driver_push_staff_active(p_driver_id text)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from (select self_order_settings from public.store_settings order by updated_at desc nulls last limit 1) s,
    lateral jsonb_array_elements(coalesce(s.self_order_settings->'staff'->'members', '[]'::jsonb)) m
    where m->>'id' = p_driver_id and coalesce(m->>'active','true') <> 'false'
      and not coalesce(s.self_order_settings->'staff'->'deletedStaffIds','[]'::jsonb) ? p_driver_id
      and (coalesce(m->>'role','') in ('owner','manager','driver') or coalesce(m->'menuAccess','[]'::jsonb) ? 'driver')
  );
$$;
revoke all on function public.driver_push_staff_active(text) from public, anon, authenticated;
grant execute on function public.driver_push_staff_active(text) to service_role;

-- PIN is verified once and never persisted. Renewals use a random per-device capability.
create or replace function public.register_driver_push_device(
  p_device_id uuid, p_secret text, p_token text, p_enabled boolean,
  p_login text default null, p_pin text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_device public.driver_push_devices%rowtype; v_driver text;
begin
  if p_device_id is null or p_secret is null or p_secret !~ '^[a-f0-9]{64}$'
    or length(coalesce(p_token,'')) not between 32 and 4096 then
    raise exception 'Invalid device registration' using errcode='22023';
  end if;
  select * into v_device from public.driver_push_devices where id=p_device_id for update;
  if v_device.id is not null and v_device.secret_hash=encode(extensions.digest(p_secret,'sha256'),'hex') and v_device.expires_at>now() then
    v_driver:=v_device.driver_id;
  else
    select driver_id into v_driver from public.authenticate_driver_staff(p_login,p_pin) limit 1;
    if v_driver is null or (v_device.id is not null and v_device.driver_id<>v_driver) then
      raise exception 'Driver authentication required' using errcode='28000';
    end if;
  end if;
  if not public.driver_push_staff_active(v_driver) then raise exception 'Driver access revoked' using errcode='28000'; end if;
  insert into public.driver_push_devices(id,driver_id,secret_hash,fcm_token,enabled,expires_at,updated_at)
    values(p_device_id,v_driver,encode(extensions.digest(p_secret,'sha256'),'hex'),p_token,coalesce(p_enabled,false),now()+interval '30 days',now())
    on conflict(id) do update set secret_hash=excluded.secret_hash,fcm_token=excluded.fcm_token,enabled=excluded.enabled,expires_at=excluded.expires_at,updated_at=excluded.updated_at;
  return jsonb_build_object('ok',true);
end;
$$;
revoke all on function public.register_driver_push_device(uuid,text,text,boolean,text,text) from public;
grant execute on function public.register_driver_push_device(uuid,text,text,boolean,text,text) to anon,authenticated;

-- Server event sends a small offer/cancellation push; repetitions happen on-device.
create or replace function public.kasirin_notify_driver_push()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_secret text; v_event text; v_eligible boolean; v_was_offer boolean:=false;
begin
  if coalesce(new.customer_order_type::text,'')<>'DELIVERY' then return new; end if;
  v_eligible:=coalesce(new.customer_order_status::text,'')='SEARCHING_DRIVER'
    and new.cancelled_at is null and coalesce(new.status::text,'') not in ('Dibatalkan','Batal')
    and nullif(new.driver_id::text,'') is null and nullif(new.driver_name,'') is null and nullif(new.driver_phone,'') is null
    and (coalesce(new.payment_provider::text,'')='courier_cash' or coalesce(new.payment_status::text,'')='Lunas');
  if tg_op='UPDATE' then
    v_was_offer:=coalesce(old.customer_order_status::text,'')='SEARCHING_DRIVER';
    if v_eligible and old.updated_at is not distinct from new.updated_at then return new; end if;
  end if;
  if v_eligible then v_event:='driver_offer'; elsif v_was_offer then v_event:='driver_cancel'; else return new; end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name='kasirin_push_internal_secret' limit 1;
  if nullif(v_secret,'') is null then raise warning 'Driver push secret not configured'; return new; end if;
  perform net.http_post(
    url:='https://pjkotqianxecaawqompo.supabase.co/functions/v1/notify-new-order',
    headers:=jsonb_build_object('Content-Type','application/json','x-kasirin-push-secret',v_secret),
    body:=jsonb_build_object('target','driver','eventType',v_event,'orderId',new.id,'revisionAt',coalesce(new.updated_at,new.created_at)),
    timeout_milliseconds:=15000);
  return new;
exception when others then
  raise warning 'Driver push enqueue failed: %',sqlerrm;
  return new;
end;
$$;
revoke all on function public.kasirin_notify_driver_push() from public,anon,authenticated;
drop trigger if exists trg_kasirin_notify_driver_push on public.orders;
create trigger trg_kasirin_notify_driver_push after insert or update on public.orders for each row execute function public.kasirin_notify_driver_push();
notify pgrst,'reload schema';
commit;
