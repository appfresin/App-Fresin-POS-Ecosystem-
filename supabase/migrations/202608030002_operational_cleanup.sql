begin;

create table if not exists public.maintenance_runs (
  job_name text primary key,
  last_started_at timestamptz,
  last_finished_at timestamptz,
  last_result jsonb not null default '{}'::jsonb
);

create or replace function public.cleanup_operational_data(
  p_retention_days integer default 31,
  p_min_interval_hours integer default 20
)
returns table(ran boolean, skipped boolean, deleted jsonb, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job text := 'operational_cleanup';
  v_retention_days integer := greatest(7, least(366, coalesce(p_retention_days, 31)));
  v_min_interval_hours integer := greatest(1, least(168, coalesce(p_min_interval_hours, 20)));
  v_cutoff timestamptz := now() - make_interval(days => v_retention_days);
  v_last_finished_at timestamptz;
  v_deleted jsonb := '{}'::jsonb;
  v_count integer := 0;
  v_lock_key bigint := hashtextextended('kasirin_operational_cleanup', 0);
begin
  if not pg_try_advisory_lock(v_lock_key) then
    return query select false, true, v_deleted, 'locked'::text;
    return;
  end if;

  select last_finished_at into v_last_finished_at
  from public.maintenance_runs
  where job_name = v_job;

  if v_last_finished_at is not null
    and v_last_finished_at > now() - make_interval(hours => v_min_interval_hours)
  then
    perform pg_advisory_unlock(v_lock_key);
    return query select false, true, coalesce((select last_result from public.maintenance_runs where job_name = v_job), v_deleted), 'recently_cleaned'::text;
    return;
  end if;

  insert into public.maintenance_runs(job_name, last_started_at, last_result)
  values (v_job, now(), jsonb_build_object('status', 'running'))
  on conflict (job_name) do update
    set last_started_at = excluded.last_started_at,
        last_result = excluded.last_result;

  if to_regclass('public.limited_stock_reservations') is not null then
    delete from public.limited_stock_reservations
    where expires_at <= now();
    get diagnostics v_count = row_count;
    v_deleted := v_deleted || jsonb_build_object('limited_stock_reservations', v_count);
  end if;

  if to_regclass('public.limited_stock_commits') is not null then
    delete from public.limited_stock_commits
    where created_at < v_cutoff;
    get diagnostics v_count = row_count;
    v_deleted := v_deleted || jsonb_build_object('limited_stock_commits', v_count);
  end if;

  if to_regclass('public.product_availability_events') is not null
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'product_availability_events' and column_name = 'created_at'
    )
  then
    execute 'delete from public.product_availability_events where created_at < $1' using v_cutoff;
    get diagnostics v_count = row_count;
    v_deleted := v_deleted || jsonb_build_object('product_availability_events', v_count);
  end if;

  if to_regclass('public.stock_movements') is not null
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'stock_movements' and column_name = 'created_at'
    )
  then
    execute 'delete from public.stock_movements where created_at < $1' using v_cutoff;
    get diagnostics v_count = row_count;
    v_deleted := v_deleted || jsonb_build_object('stock_movements', v_count);
  end if;

  if to_regclass('public.orders') is not null
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'orders' and column_name = 'created_at'
    )
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'orders' and column_name = 'payment_status'
    )
  then
    -- payment_status not in ('Lunas', 'Paid', 'Dibayar', 'Sudah bayar', 'Selesai bayar')
    if to_regclass('public.order_item_addons') is not null and to_regclass('public.order_items') is not null then
      execute $cleanup$
        with old_orders as (
          select id from public.orders
          where created_at < $1
            and coalesce(payment_status, '') not in ('Lunas', 'Paid', 'Dibayar', 'Sudah bayar', 'Selesai bayar')
        )
        delete from public.order_item_addons addon
        using public.order_items item, old_orders old_order
        where addon.order_item_id = item.id and item.order_id = old_order.id
      $cleanup$ using v_cutoff;
      get diagnostics v_count = row_count;
      v_deleted := v_deleted || jsonb_build_object('order_item_addons', v_count);
    end if;

    if to_regclass('public.payments') is not null then
      execute $cleanup$
        with old_orders as (
          select id from public.orders
          where created_at < $1
            and coalesce(payment_status, '') not in ('Lunas', 'Paid', 'Dibayar', 'Sudah bayar', 'Selesai bayar')
        )
        delete from public.payments payment
        using old_orders old_order
        where payment.order_id = old_order.id
      $cleanup$ using v_cutoff;
      get diagnostics v_count = row_count;
      v_deleted := v_deleted || jsonb_build_object('payments', v_count);
    end if;

    if to_regclass('public.order_items') is not null then
      execute $cleanup$
        with old_orders as (
          select id from public.orders
          where created_at < $1
            and coalesce(payment_status, '') not in ('Lunas', 'Paid', 'Dibayar', 'Sudah bayar', 'Selesai bayar')
        )
        delete from public.order_items item
        using old_orders old_order
        where item.order_id = old_order.id
      $cleanup$ using v_cutoff;
      get diagnostics v_count = row_count;
      v_deleted := v_deleted || jsonb_build_object('order_items', v_count);
    end if;

    execute $cleanup$
      delete from public.orders
      where created_at < $1
        and coalesce(payment_status, '') not in ('Lunas', 'Paid', 'Dibayar', 'Sudah bayar', 'Selesai bayar')
    $cleanup$ using v_cutoff;
    get diagnostics v_count = row_count;
    v_deleted := v_deleted || jsonb_build_object('orders', v_count);
  end if;

  update public.maintenance_runs
  set last_finished_at = now(),
      last_result = jsonb_build_object(
        'status', 'completed',
        'retentionDays', v_retention_days,
        'cutoff', v_cutoff,
        'deleted', v_deleted
      )
  where job_name = v_job;

  perform pg_advisory_unlock(v_lock_key);
  return query select true, false, v_deleted, 'completed'::text;
exception when others then
  perform pg_advisory_unlock(v_lock_key);
  update public.maintenance_runs
  set last_finished_at = now(),
      last_result = jsonb_build_object('status', 'failed', 'message', sqlerrm)
  where job_name = v_job;
  raise;
end;
$$;

revoke all on table public.maintenance_runs from anon, authenticated;
grant select on table public.maintenance_runs to anon, authenticated;

revoke all on function public.cleanup_operational_data(integer, integer) from public;
grant execute on function public.cleanup_operational_data(integer, integer) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
