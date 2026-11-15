-- Native FCM push notification foundation for Kasirin APK.
-- Run this in Supabase SQL editor before deploying the Edge Functions.

create extension if not exists pgcrypto;
create extension if not exists pg_net;

create table if not exists public.device_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  fcm_token text not null unique,
  platform text not null default 'android',
  scope_key text not null default 'default',
  target text not null default 'all' check (target in ('all', 'kasir', 'dapur')),
  device_name text not null default 'Kasirin Android',
  app_version text not null default '',
  kitchen_categories text[] not null default '{}'::text[],
  is_active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.device_push_tokens
  add column if not exists kitchen_categories text[] not null default '{}'::text[];

alter table public.orders
  add column if not exists notification_categories text[] not null default '{}'::text[];

drop function if exists public.kasirin_order_notification_status(uuid);
create function public.kasirin_order_notification_status(p_order_id uuid)
returns table(status text, notification_categories text[])
language sql
stable
security definer
set search_path = public
as $$
  select orders.status::text, coalesce(orders.notification_categories, '{}'::text[])
  from public.orders
  where orders.id = p_order_id
  limit 1;
$$;

revoke all on function public.kasirin_order_notification_status(uuid) from public;
grant execute on function public.kasirin_order_notification_status(uuid) to anon, authenticated;

create index if not exists idx_device_push_tokens_active_target
  on public.device_push_tokens (scope_key, is_active, target);

create table if not exists public.push_notification_logs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid null,
  order_number text not null default '',
  event_type text not null default 'new_order',
  target text not null default 'all',
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  error text not null default '',
  created_at timestamptz not null default now()
);

alter table public.device_push_tokens enable row level security;
alter table public.push_notification_logs enable row level security;

drop policy if exists "device_push_tokens_owner_read" on public.device_push_tokens;
create policy "device_push_tokens_owner_read"
  on public.device_push_tokens
  for select
  to authenticated
  using (auth.uid() = user_id);

-- No client read/write policy is created for push_notification_logs.
-- Edge Functions use the service role key and bypass RLS for operational logs.

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
      'tone', 'alert',
      'orderCategories', coalesce(new.notification_categories, '{}'::text[])
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

drop trigger if exists trg_kasirin_notify_order_push on public.orders;
create trigger trg_kasirin_notify_order_push
  after insert or update on public.orders
  for each row
  execute function public.kasirin_notify_order_push();

notify pgrst, 'reload schema';
