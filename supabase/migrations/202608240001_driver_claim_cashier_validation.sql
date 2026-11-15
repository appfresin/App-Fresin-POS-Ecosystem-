-- Driver earnings claim cashier validation.
-- Read-only bridge so the DRIVER app can confirm a cashier PIN without
-- exposing the full POS staff list or service role keys to the frontend.

begin;

create or replace function public.validate_driver_claim_cashier_pin(
  p_pin text,
  p_outlet text default null
)
returns table (
  cashier_id text,
  username text,
  name text,
  role text,
  outlet_name text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings jsonb := '{}'::jsonb;
  v_staff jsonb := '{}'::jsonb;
  v_member jsonb;
  v_deleted_ids text[] := '{}'::text[];
  v_role text;
  v_outlet text;
begin
  if coalesce(p_pin, '') !~ '^[0-9]{6}$' then
    return;
  end if;

  select coalesce(self_order_settings, '{}'::jsonb)
    into v_settings
  from public.store_settings
  order by updated_at desc nulls last
  limit 1;

  v_staff := coalesce(v_settings->'staff', '{}'::jsonb);
  v_outlet := coalesce(
    nullif(v_settings->>'receiptStoreName', ''),
    nullif(v_settings->>'selfOrderAppName', ''),
    nullif(p_outlet, ''),
    'Fresin'
  );

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

    v_role := coalesce(nullif(v_member->>'role', ''), 'kasir');
    if v_role not in ('owner', 'manager', 'kasir') then
      continue;
    end if;

    cashier_id := coalesce(v_member->>'id', v_member->>'username', v_member->>'name');
    username := coalesce(v_member->>'username', v_member->>'name', cashier_id);
    name := coalesce(v_member->>'name', username, cashier_id);
    role := v_role;
    outlet_name := v_outlet;
    return next;
    return;
  end loop;

  return;
end;
$$;

grant execute on function public.validate_driver_claim_cashier_pin(text, text) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
