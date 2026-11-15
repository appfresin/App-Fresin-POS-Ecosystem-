-- Driver staff login bridge.
-- Lets the DRIVER app authenticate against staff accounts managed from POS Settings
-- without exposing the full staff list or service role keys to the frontend.

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
set search_path = public
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

grant execute on function public.authenticate_driver_staff(text, text) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
