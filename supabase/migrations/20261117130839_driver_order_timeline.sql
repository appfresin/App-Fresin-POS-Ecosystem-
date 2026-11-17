begin;

alter table public.orders add column if not exists driver_accepted_at timestamptz;

create or replace function public.record_driver_acceptance_time()
returns trigger language plpgsql set search_path = '' as $function$
begin
  new.driver_accepted_at := statement_timestamp();
  return new;
end;
$function$;

revoke execute on function public.record_driver_acceptance_time() from public;

create or replace trigger orders_record_driver_acceptance_time
before update of customer_order_status on public.orders
for each row when (
  old.customer_order_status = 'SEARCHING_DRIVER'
  and new.customer_order_status = 'DRIVER_ASSIGNED'
  and nullif(new.driver_id::text, '') is not null
)
execute function public.record_driver_acceptance_time();

-- Add the timestamps to the existing feed behind its driver device checks.
do $migration$
declare
  feed text := pg_get_functiondef('public.driver_order_feed(uuid,text,timestamptz,timestamptz)'::regprocedure);
  updated_feed text := feed;
begin
  if strpos(updated_feed, '''driver_accepted_at''') = 0 then
    updated_feed := replace(updated_feed, '''delivery_longitude''', '''delivery_longitude'',''driver_accepted_at''');
    if strpos(updated_feed, '''driver_accepted_at''') = 0 then
      raise exception 'Driver feed does not include the expected delivery columns';
    end if;
  end if;

  if strpos(updated_feed, '''cashier_paid_at''') = 0 then
    updated_feed := replace(updated_feed, $anchor$'driver_phone']))$anchor$, $result$'driver_phone']))
      || jsonb_build_object('cashier_paid_at', case
        when o.payment_provider = 'courier_cash' and o.payment_status::text = 'Lunas' then (
          select p.paid_at from public.payments p where p.order_id = o.id
          order by p.paid_at desc nulls last limit 1
        )
      end)$result$);
    if strpos(updated_feed, '''cashier_paid_at''') = 0 then
      raise exception 'Driver feed does not include the expected result expression';
    end if;
  end if;

  if updated_feed <> feed then execute updated_feed; end if;
end;
$migration$;

notify pgrst, 'reload schema';

commit;
