-- Allocate readable customer order numbers across devices, before stock commits.
-- Gaps are intentional: retries and abandoned checkouts must not reuse numbers.
create sequence public.customer_delivery_number_seq;
create sequence public.customer_pickup_number_seq;

select pg_catalog.setval('public.customer_delivery_number_seq',
  coalesce((select max(substring(order_number from 2)::bigint) + 1
    from public.orders where order_number ~ '^D[0-9]{1,18}$'), 1), false);
select pg_catalog.setval('public.customer_pickup_number_seq',
  coalesce((select max(substring(order_number from 2)::bigint) + 1
    from public.orders where order_number ~ '^P[0-9]{1,18}$'), 1), false);

revoke all on sequence public.customer_delivery_number_seq, public.customer_pickup_number_seq
  from public, anon, authenticated;
grant usage on sequence public.customer_delivery_number_seq, public.customer_pickup_number_seq
  to anon, authenticated, service_role;

create function public.allocate_customer_order_number(p_prefix text)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  v_number bigint;
begin
  if p_prefix = 'D' then
    v_number := pg_catalog.nextval('public.customer_delivery_number_seq'::regclass);
  elsif p_prefix = 'P' then
    v_number := pg_catalog.nextval('public.customer_pickup_number_seq'::regclass);
  else
    raise exception 'Invalid customer order prefix' using errcode = '22023';
  end if;
  return p_prefix || pg_catalog.lpad(v_number::text, greatest(3, length(v_number::text)), '0');
end;
$$;
revoke all on function public.allocate_customer_order_number(text) from public;
grant execute on function public.allocate_customer_order_number(text) to anon, authenticated, service_role;
