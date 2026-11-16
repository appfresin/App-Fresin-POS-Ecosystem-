-- Device-local T001 counters can collide. Reserve numbers before stock or order writes.
create sequence public.customer_takeaway_number_seq;
select pg_catalog.setval('public.customer_takeaway_number_seq',
  coalesce((select max(substring(order_number from 2)::bigint) + 1
    from public.orders where order_number ~ '^T[0-9]{1,18}$'), 1), false);
revoke all on sequence public.customer_takeaway_number_seq from public, anon, authenticated;
grant usage on sequence public.customer_takeaway_number_seq to anon, authenticated, service_role;

create or replace function public.allocate_customer_order_number(p_prefix text)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  v_number bigint;
begin
  if p_prefix = 'D' then
    v_number := pg_catalog.nextval('public.customer_delivery_number_seq'::regclass);
  elsif p_prefix = 'P' then
    v_number := pg_catalog.nextval('public.customer_pickup_number_seq'::regclass);
  elsif p_prefix = 'T' then
    v_number := pg_catalog.nextval('public.customer_takeaway_number_seq'::regclass);
  else
    raise exception 'Invalid customer order prefix' using errcode = '22023';
  end if;
  return p_prefix || pg_catalog.lpad(v_number::text, greatest(3, length(v_number::text)), '0');
end;
$$;
revoke all on function public.allocate_customer_order_number(text) from public;
grant execute on function public.allocate_customer_order_number(text) to anon, authenticated, service_role;

-- Also protect existing orders from older cached clients that still generate T001.
create function public.guard_takeaway_order_identity()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.order_number ~ '^T[0-9]{1,18}$' and (
    new.order_number is distinct from old.order_number
    or new.created_at is distinct from old.created_at
    or (nullif(old.public_order_token, '') is not null
      and new.public_order_token is distinct from old.public_order_token)
  ) then
    raise exception 'Identitas pesanan Take Away tidak dapat ditimpa oleh pesanan lain.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_takeaway_order_identity() from public;
create trigger guard_takeaway_order_identity
before update of order_number, created_at, public_order_token on public.orders
for each row execute function public.guard_takeaway_order_identity();
