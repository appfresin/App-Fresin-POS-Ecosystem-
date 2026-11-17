alter table public.orders
  add column delivery_distance_meters integer
  check (delivery_distance_meters >= 0);

-- Keep the deployed feed's access and order filters while exposing the new field.
do $migration$
declare
  feed text := pg_get_functiondef('public.driver_order_feed(uuid,text,timestamptz,timestamptz)'::regprocedure);
  updated_feed text;
begin
  updated_feed := replace(feed, '''delivery_longitude''', '''delivery_longitude'',''delivery_distance_meters''');
  if feed = updated_feed then
    raise exception 'Driver feed does not include the expected delivery columns';
  end if;
  execute updated_feed;
end;
$migration$;

notify pgrst, 'reload schema';
