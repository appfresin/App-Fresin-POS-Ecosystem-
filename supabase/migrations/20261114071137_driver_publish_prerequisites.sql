-- Deployment prerequisite bridge for projects missing the earlier staff and cash-push migrations.
-- Preserves prepaid push behavior. Does not alter existing orders, report views or table RLS.
begin;

create or replace function public.authenticate_driver_staff(p_login text, p_pin text)
returns table (
  driver_id text,
  username text,
  name text,
  role text,
  menu_access text[]
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings jsonb := '{}'::jsonb;
  v_staff jsonb := '{}'::jsonb;
  v_member jsonb;
  v_login_key text := lower(regexp_replace(coalesce(p_login, ''), '\s+', '', 'g'));
  v_member_key text;
  v_deleted_ids text[] := '{}'::text[];
  v_access text[] := '{}'::text[];
  v_role text;
begin
  if v_login_key = '' or coalesce(p_pin, '') = '' then
    return;
  end if;

  select coalesce(self_order_settings, '{}'::jsonb)
    into v_settings
  from public.store_settings
  order by updated_at desc nulls last
  limit 1;

  v_staff := coalesce(v_settings->'staff', '{}'::jsonb);

  select coalesce(array_agg(value), '{}'::text[])
    into v_deleted_ids
  from jsonb_array_elements_text(coalesce(v_staff->'deletedStaffIds', '[]'::jsonb)) as value;

  for v_member in
    select value
    from jsonb_array_elements(coalesce(v_staff->'members', '[]'::jsonb)) as value
  loop
    if v_member ? 'active' and (v_member->>'active')::boolean = false then
      continue;
    end if;

    if coalesce(v_member->>'id', '') = any(v_deleted_ids) then
      continue;
    end if;

    if coalesce(v_member->>'pin', '') <> p_pin then
      continue;
    end if;

    select coalesce(array_agg(value), '{}'::text[])
      into v_access
    from jsonb_array_elements_text(coalesce(v_member->'menuAccess', '[]'::jsonb)) as value;

    v_role := coalesce(nullif(v_member->>'role', ''), 'kasir');

    if not (v_role in ('owner', 'manager', 'driver') or 'driver' = any(v_access)) then
      continue;
    end if;

    foreach v_member_key in array array[
      coalesce(v_member->>'username', ''),
      coalesce(v_member->>'id', ''),
      coalesce(v_member->>'name', '')
    ]
    loop
      if lower(regexp_replace(v_member_key, '\s+', '', 'g')) = v_login_key then
        driver_id := coalesce(v_member->>'id', v_member->>'username', v_member->>'name');
        username := coalesce(v_member->>'username', v_member->>'name', driver_id);
        name := coalesce(v_member->>'name', username, driver_id);
        role := v_role;
        menu_access := v_access;
        return next;
        return;
      end if;
    end loop;
  end loop;

  return;
end;
$$;

revoke all on function public.authenticate_driver_staff(text, text) from public;

grant execute on function public.authenticate_driver_staff(text, text) to anon, authenticated;


-- Preserve the deployed legacy notification implementation for prepaid orders.
-- Cash orders have a separate trigger below, including cashier acceptance.
do $patch$
declare definition text;
begin
  select pg_get_functiondef('public.kasirin_notify_order_push()'::regprocedure) into definition;
  if position('CASH_ORDER_NOTIFICATION_DELEGATED' in definition) = 0 then
    definition := regexp_replace(definition, '(?in)^begin[[:space:]]*$',
      E'begin\n  -- CASH_ORDER_NOTIFICATION_DELEGATED\n  if coalesce(new.payment_provider, '''') in (''cash_at_outlet'', ''courier_cash'') then return new; end if;');
    if position('CASH_ORDER_NOTIFICATION_DELEGATED' in definition) = 0 then
      raise exception 'Cannot safely locate notification function entry point';
    end if;
    execute definition;
  end if;
end;
$patch$;

create or replace function public.kasirin_notify_cash_order_push()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, vault, net
as $$
declare internal_secret text; event_type text; target_role text; request_id bigint;
begin
  if coalesce(new.payment_provider, '') not in ('cash_at_outlet', 'courier_cash')
    or coalesce(new.customer_order_type, '') not in ('PICKUP_PREORDER', 'DELIVERY')
    or coalesce(new.status::text, '') in ('Dibatalkan', 'Selesai') then return new; end if;
  if new.customer_order_type = 'DELIVERY' and nullif(new.driver_id, '') is null then return new; end if;

  if tg_op = 'INSERT' then event_type := 'new_order';
  elsif tg_op = 'UPDATE' then
    if (old.confirmed_at is null and new.confirmed_at is not null)
      or (nullif(old.driver_id, '') is null and nullif(new.driver_id, '') is not null) then event_type := 'new_order';
    elsif coalesce(new.subtotal, 0) > coalesce(old.subtotal, 0) then event_type := 'additional_order';
    else return new; end if;
  else return new; end if;

  target_role := case when new.confirmed_at is null then 'kasir' else 'all' end;
  select decrypted_secret into internal_secret from vault.decrypted_secrets
    where name = 'kasirin_push_internal_secret' limit 1;
  if nullif(internal_secret, '') is null then return new; end if;
  select net.http_post(
    url := 'https://pjkotqianxecaawqompo.supabase.co/functions/v1/notify-new-order',
    headers := jsonb_build_object('Content-Type','application/json','x-kasirin-push-secret',internal_secret),
    body := jsonb_build_object('internal',true,'eventType',event_type,'orderId',new.id,
      'orderNumber',new.order_number,'source',new.source,'customer',coalesce(new.customer_name,''),
      'scopeKey','outlet-utama','target',target_role,'tone','alert',
      'orderCategories',coalesce(new.notification_categories,'{}'::text[])),
    timeout_milliseconds := 15000
  ) into request_id;
  return new;
exception when others then
  raise warning 'Cash order notification failed: %', sqlerrm;
  return new;
end;
$$;
revoke all on function public.kasirin_notify_cash_order_push() from public;
drop trigger if exists trg_kasirin_notify_cash_order_push on public.orders;
create trigger trg_kasirin_notify_cash_order_push after insert or update on public.orders
for each row execute function public.kasirin_notify_cash_order_push();


notify pgrst, 'reload schema';
commit;
