-- Atomic limited-stock reservations for POS and Self Order.
-- Safe to run more than once in the Supabase SQL Editor.

begin;

create extension if not exists pgcrypto;

alter table if exists public.products
  add column if not exists local_id text,
  add column if not exists sold_out_variants jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.stock_movements
  add column if not exists product_local_id text,
  add column if not exists variant_key text,
  add column if not exists variant_label text,
  add column if not exists movement_type text not null default 'adjustment',
  add column if not exists balance_after numeric(14,2),
  add column if not exists note text;

create table if not exists public.limited_stock_reservations (
  id uuid primary key default gen_random_uuid(),
  cart_token text not null,
  source text not null check (source in ('POS', 'Self Order')),
  product_id uuid not null references public.products(id) on delete cascade,
  product_local_id text not null,
  variant_key text not null default '',
  qty numeric(14,2) not null check (qty > 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cart_token, product_id, variant_key)
);

create index if not exists idx_limited_stock_reservations_active
  on public.limited_stock_reservations(product_id, variant_key, expires_at);

create index if not exists idx_limited_stock_reservations_cart
  on public.limited_stock_reservations(cart_token, expires_at);

create table if not exists public.limited_stock_commits (
  cart_token text primary key,
  order_number text not null,
  source text not null,
  items jsonb not null default '[]'::jsonb,
  committed_at timestamptz not null default now(),
  restored_at timestamptz
);

alter table public.limited_stock_commits
  drop constraint if exists limited_stock_commits_order_number_key;

create index if not exists idx_limited_stock_commits_order
  on public.limited_stock_commits(order_number);

create or replace function public.limited_stock_variant_state(
  p_product jsonb,
  p_variant_key text default ''
)
returns table(tracked boolean, stock numeric, label text)
language plpgsql
immutable
set search_path = public
as $$
declare
  v_option jsonb;
  v_parent jsonb;
  v_parent_name text;
  v_child_name text;
begin
  if coalesce(p_product->>'variant_mode', 'off') = 'off' then
    tracked := coalesce((p_product->>'track_stock')::boolean, false);
    stock := greatest(0, coalesce((p_product->>'stock')::numeric, 0));
    label := coalesce(p_product->>'name', 'Produk');
    return next;
    return;
  end if;

  if coalesce(p_product->>'variant_mode', 'off') = '2' then
    v_parent_name := split_part(coalesce(p_variant_key, ''), '|||', 1);
    v_child_name := split_part(coalesce(p_variant_key, ''), '|||', 2);
    select value into v_parent
    from jsonb_array_elements(coalesce(p_product->'variant_options', '[]'::jsonb))
    where value->>'name' = v_parent_name
    limit 1;
    select value into v_option
    from jsonb_array_elements(coalesce(v_parent->'children', '[]'::jsonb))
    where value->>'name' = v_child_name
    limit 1;
    label := concat_ws(' / ', nullif(v_parent_name, ''), nullif(v_child_name, ''));
  else
    select value into v_option
    from jsonb_array_elements(coalesce(p_product->'variant_options', '[]'::jsonb))
    where value->>'name' = coalesce(p_variant_key, '')
    limit 1;
    label := coalesce(v_option->>'name', p_variant_key, 'Varian');
  end if;

  tracked := coalesce((v_option->>'trackStock')::boolean, false);
  stock := greatest(0, coalesce((v_option->>'stock')::numeric, 0));
  return next;
end;
$$;

create or replace function public.limited_stock_set_variant_stock(
  p_options jsonb,
  p_variant_mode text,
  p_variant_key text,
  p_stock numeric
)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_result jsonb := '[]'::jsonb;
  v_children jsonb;
  v_option jsonb;
  v_child jsonb;
  v_parent_name text := split_part(coalesce(p_variant_key, ''), '|||', 1);
  v_child_name text := split_part(coalesce(p_variant_key, ''), '|||', 2);
  v_stock numeric := greatest(0, coalesce(p_stock, 0));
begin
  for v_option in select value from jsonb_array_elements(coalesce(p_options, '[]'::jsonb)) loop
    if p_variant_mode = '2' and v_option->>'name' = v_parent_name then
      v_children := '[]'::jsonb;
      for v_child in select value from jsonb_array_elements(coalesce(v_option->'children', '[]'::jsonb)) loop
        if v_child->>'name' = v_child_name then
          v_child := jsonb_set(v_child, '{stock}', to_jsonb(v_stock), true);
          if v_stock <= 0 then
            v_child := jsonb_set(v_child, '{stockAutoSoldOut}', 'true'::jsonb, true);
          else
            v_child := v_child - 'stockAutoSoldOut';
          end if;
        end if;
        v_children := v_children || jsonb_build_array(v_child);
      end loop;
      v_option := jsonb_set(v_option, '{children}', v_children, true);
    elsif p_variant_mode <> '2' and v_option->>'name' = p_variant_key then
      v_option := jsonb_set(v_option, '{stock}', to_jsonb(v_stock), true);
      if v_stock <= 0 then
        v_option := jsonb_set(v_option, '{stockAutoSoldOut}', 'true'::jsonb, true);
      else
        v_option := v_option - 'stockAutoSoldOut';
      end if;
    end if;
    v_result := v_result || jsonb_build_array(v_option);
  end loop;
  return v_result;
end;
$$;

drop function if exists public.limited_stock_reservation_totals(text);

create function public.limited_stock_reservation_totals(p_cart_token text default '')
returns table(
  product_local_id text,
  variant_key text,
  reserved_total numeric,
  reserved_by_cart numeric,
  next_expires_at timestamptz,
  own_expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.limited_stock_reservations r where r.expires_at <= now();
  return query
  select
    r.product_local_id,
    r.variant_key,
    sum(r.qty)::numeric,
    sum(case when r.cart_token = coalesce(p_cart_token, '') then r.qty else 0 end)::numeric,
    min(r.expires_at),
    max(case when r.cart_token = coalesce(p_cart_token, '') then r.expires_at else null end)
  from public.limited_stock_reservations r
  where r.expires_at > now()
  group by r.product_local_id, r.variant_key;
end;
$$;

create or replace function public.reserve_limited_stock(
  p_cart_token text,
  p_product_local_id text,
  p_variant_key text default '',
  p_qty numeric default 0,
  p_source text default 'POS',
  p_ttl_seconds integer default 600
)
returns table(
  accepted boolean,
  available numeric,
  reserved numeric,
  expires_at timestamptz,
  product_name text,
  variant_label text,
  reason text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product public.products%rowtype;
  v_tracked boolean := false;
  v_stock numeric := 0;
  v_label text := '';
  v_others numeric := 0;
  v_existing numeric := 0;
  v_available numeric := 0;
  v_expires timestamptz;
  v_variant_key text := coalesce(p_variant_key, '');
  v_qty numeric := greatest(0, floor(coalesce(p_qty, 0)));
begin
  if length(trim(coalesce(p_cart_token, ''))) < 12 then
    raise exception 'Token keranjang tidak valid';
  end if;
  if p_source not in ('POS', 'Self Order') then
    raise exception 'Sumber reservasi tidak valid';
  end if;

  select * into v_product
  from public.products
  where local_id = p_product_local_id or id::text = p_product_local_id
  order by case when local_id = p_product_local_id then 0 else 1 end
  limit 1
  for update;

  if not found then
    return query select false, 0::numeric, 0::numeric, null::timestamptz, 'Produk'::text, v_variant_key, 'not_found'::text;
    return;
  end if;

  select s.tracked, s.stock, s.label
  into v_tracked, v_stock, v_label
  from public.limited_stock_variant_state(to_jsonb(v_product), v_variant_key) s;

  delete from public.limited_stock_reservations r
  where r.product_id = v_product.id and r.variant_key = v_variant_key and r.expires_at <= now();

  select coalesce(sum(qty), 0) into v_others
  from public.limited_stock_reservations r
  where r.product_id = v_product.id
    and r.variant_key = v_variant_key
    and r.cart_token <> p_cart_token
    and r.expires_at > now();

  select coalesce(max(qty), 0) into v_existing
  from public.limited_stock_reservations r
  where r.product_id = v_product.id
    and r.variant_key = v_variant_key
    and r.cart_token = p_cart_token
    and r.expires_at > now();

  v_available := greatest(0, v_stock - v_others);
  if not v_tracked then
    delete from public.limited_stock_reservations
    where product_id = v_product.id and variant_key = v_variant_key and cart_token = p_cart_token;
    return query select true, v_stock, 0::numeric, null::timestamptz, v_product.name, v_label, 'not_limited'::text;
    return;
  end if;
  if v_product.sold_out or coalesce((v_product.sold_out_variants->>v_variant_key)::boolean, false) then
    return query select false, 0::numeric, v_existing, null::timestamptz, v_product.name, v_label, 'sold_out'::text;
    return;
  end if;
  if v_qty > v_available then
    return query select false, v_available, v_existing, null::timestamptz, v_product.name, v_label, 'insufficient'::text;
    return;
  end if;
  if v_qty <= 0 then
    delete from public.limited_stock_reservations
    where product_id = v_product.id and variant_key = v_variant_key and cart_token = p_cart_token;
    return query select true, v_available, 0::numeric, null::timestamptz, v_product.name, v_label, 'released'::text;
    return;
  end if;

  v_expires := now() + make_interval(secs => greatest(60, least(coalesce(p_ttl_seconds, 600), 7200)));
  insert into public.limited_stock_reservations(
    cart_token, source, product_id, product_local_id, variant_key, qty, expires_at, updated_at
  ) values (
    p_cart_token, p_source, v_product.id, coalesce(v_product.local_id, v_product.id::text), v_variant_key, v_qty, v_expires, now()
  )
  on conflict (cart_token, product_id, variant_key) do update
  set qty = excluded.qty,
      source = excluded.source,
      product_local_id = excluded.product_local_id,
      expires_at = excluded.expires_at,
      updated_at = now();

  return query select true, v_available, v_qty, v_expires, v_product.name, v_label, 'reserved'::text;
end;
$$;

create or replace function public.release_limited_stock_reservations(p_cart_token text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  delete from public.limited_stock_reservations where cart_token = p_cart_token;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.commit_limited_stock_reservations(
  p_cart_token text,
  p_order_number text,
  p_source text default 'POS'
)
returns table(accepted boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reservation public.limited_stock_reservations%rowtype;
  v_product public.products%rowtype;
  v_tracked boolean;
  v_stock numeric;
  v_label text;
  v_next_stock numeric;
  v_items jsonb;
  v_existing_order text;
begin
  select order_number into v_existing_order
  from public.limited_stock_commits where cart_token = p_cart_token;
  if found then
    return query select (v_existing_order = p_order_number), case when v_existing_order = p_order_number then 'already_committed' else 'token_reused' end;
    return;
  end if;

  if exists (
    select 1 from public.limited_stock_reservations
    where cart_token = p_cart_token and expires_at <= now()
  ) then
    delete from public.limited_stock_reservations where cart_token = p_cart_token and expires_at <= now();
    return query select false, 'expired'::text;
    return;
  end if;

  select jsonb_agg(jsonb_build_object(
    'productId', product_local_id,
    'variantKey', variant_key,
    'qty', qty
  ) order by product_id, variant_key)
  into v_items
  from public.limited_stock_reservations
  where cart_token = p_cart_token and expires_at > now();

  if v_items is null then
    return query select true, 'no_limited_stock'::text;
    return;
  end if;

  -- Lock every affected product in a stable order, then validate the whole cart
  -- before changing any stock. A rejected multi-item checkout remains all-or-nothing.
  for v_product in
    select p.*
    from public.products p
    where p.id in (
      select r.product_id
      from public.limited_stock_reservations r
      where r.cart_token = p_cart_token and r.expires_at > now()
    )
    order by p.id
    for update
  loop
    null;
  end loop;

  for v_reservation in
    select * from public.limited_stock_reservations
    where cart_token = p_cart_token and expires_at > now()
    order by product_id, variant_key
  loop
    select * into v_product from public.products where id = v_reservation.product_id;
    select s.tracked, s.stock, s.label into v_tracked, v_stock, v_label
    from public.limited_stock_variant_state(to_jsonb(v_product), v_reservation.variant_key) s;
    if not v_tracked or v_stock < v_reservation.qty then
      return query select false, 'stock_changed'::text;
      return;
    end if;
  end loop;

  for v_reservation in
    select * from public.limited_stock_reservations
    where cart_token = p_cart_token and expires_at > now()
    order by product_id, variant_key
  loop
    select * into v_product from public.products where id = v_reservation.product_id for update;
    select s.tracked, s.stock, s.label into v_tracked, v_stock, v_label
    from public.limited_stock_variant_state(to_jsonb(v_product), v_reservation.variant_key) s;
    if not v_tracked or v_stock < v_reservation.qty then
      return query select false, 'stock_changed'::text;
      return;
    end if;
    v_next_stock := greatest(0, v_stock - v_reservation.qty);
    if coalesce(v_product.variant_mode, 'off') = 'off' then
      update public.products
      set stock = v_next_stock,
          sold_out = case when v_next_stock <= 0 then true else sold_out end,
          updated_at = now()
      where id = v_product.id;
    else
      update public.products
      set variant_options = public.limited_stock_set_variant_stock(variant_options, variant_mode, v_reservation.variant_key, v_next_stock),
          sold_out_variants = case
            when v_next_stock <= 0 then jsonb_set(coalesce(sold_out_variants, '{}'::jsonb), array[v_reservation.variant_key], 'true'::jsonb, true)
            else coalesce(sold_out_variants, '{}'::jsonb) - v_reservation.variant_key
          end,
          updated_at = now()
      where id = v_product.id;
    end if;
    insert into public.stock_movements(product_id, product_local_id, variant_key, variant_label, qty, reason, movement_type, balance_after)
    values (v_product.id, v_reservation.product_local_id, v_reservation.variant_key, v_label, -v_reservation.qty, 'Reservasi ' || p_order_number, 'sale', v_next_stock);
  end loop;

  insert into public.limited_stock_commits(cart_token, order_number, source, items)
  values (p_cart_token, p_order_number, p_source, v_items);
  delete from public.limited_stock_reservations where cart_token = p_cart_token;
  return query select true, 'committed'::text;
end;
$$;

create or replace function public.restore_limited_stock_commit(p_order_number text)
returns table(restored boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_commit public.limited_stock_commits%rowtype;
  v_item jsonb;
  v_product public.products%rowtype;
  v_tracked boolean;
  v_stock numeric;
  v_label text;
  v_next_stock numeric;
  v_found boolean := false;
begin
  for v_commit in
    select * from public.limited_stock_commits
    where order_number = p_order_number and restored_at is null
    order by committed_at, cart_token
    for update
  loop
    v_found := true;
    for v_item in select value from jsonb_array_elements(v_commit.items) loop
      select * into v_product
      from public.products
      where local_id = v_item->>'productId' or id::text = v_item->>'productId'
      limit 1
      for update;
      if not found then continue; end if;
      select s.tracked, s.stock, s.label into v_tracked, v_stock, v_label
      from public.limited_stock_variant_state(to_jsonb(v_product), coalesce(v_item->>'variantKey', '')) s;
      v_next_stock := greatest(0, v_stock + greatest(0, coalesce((v_item->>'qty')::numeric, 0)));
      if coalesce(v_product.variant_mode, 'off') = 'off' then
        update public.products set stock = v_next_stock, sold_out = false, updated_at = now() where id = v_product.id;
      else
        update public.products
        set variant_options = public.limited_stock_set_variant_stock(variant_options, variant_mode, coalesce(v_item->>'variantKey', ''), v_next_stock),
            sold_out_variants = coalesce(sold_out_variants, '{}'::jsonb) - coalesce(v_item->>'variantKey', ''),
            updated_at = now()
        where id = v_product.id;
      end if;
      insert into public.stock_movements(product_id, product_local_id, variant_key, variant_label, qty, reason, movement_type, balance_after)
      values (v_product.id, v_item->>'productId', coalesce(v_item->>'variantKey', ''), v_label, (v_item->>'qty')::numeric, 'Pembatalan ' || p_order_number, 'cancel_restore', v_next_stock);
    end loop;
    update public.limited_stock_commits set restored_at = now() where cart_token = v_commit.cart_token;
  end loop;
  if not v_found then
    if exists (select 1 from public.limited_stock_commits where order_number = p_order_number and restored_at is not null) then
      return query select true, 'already_restored'::text;
    else
      return query select false, 'not_found'::text;
    end if;
    return;
  end if;
  return query select true, 'restored'::text;
end;
$$;

create or replace function public.require_self_order_customer_name()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if lower(trim(coalesce(new.source, ''))) = 'self order'
     and trim(coalesce(new.customer_name, '')) = '' then
    raise exception 'Self Order membutuhkan nama pelanggan';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_require_self_order_customer_name on public.orders;
create trigger trg_require_self_order_customer_name
before insert or update of source, customer_name on public.orders
for each row execute function public.require_self_order_customer_name();

alter table public.limited_stock_reservations disable row level security;
alter table public.limited_stock_commits disable row level security;
revoke all on table public.limited_stock_reservations from anon, authenticated;
revoke all on table public.limited_stock_commits from anon, authenticated;
grant select on public.limited_stock_reservations to anon, authenticated;
revoke all on function public.limited_stock_reservation_totals(text) from public;
revoke all on function public.reserve_limited_stock(text, text, text, numeric, text, integer) from public;
revoke all on function public.release_limited_stock_reservations(text) from public;
revoke all on function public.commit_limited_stock_reservations(text, text, text) from public;
revoke all on function public.restore_limited_stock_commit(text) from public;
grant execute on function public.limited_stock_reservation_totals(text) to anon, authenticated;
grant execute on function public.reserve_limited_stock(text, text, text, numeric, text, integer) to anon, authenticated;
grant execute on function public.release_limited_stock_reservations(text) to anon, authenticated;
grant execute on function public.commit_limited_stock_reservations(text, text, text) to anon, authenticated;
grant execute on function public.restore_limited_stock_commit(text) to anon, authenticated;

alter table public.limited_stock_reservations replica identity full;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'limited_stock_reservations'
  ) then
    alter publication supabase_realtime add table public.limited_stock_reservations;
  end if;
end $$;

commit;
