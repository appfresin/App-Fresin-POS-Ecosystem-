begin;

create or replace function public.reject_retired_takeaway_expiry()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if lower(btrim(coalesce(new.source, ''))) = 'self order'
    and lower(btrim(coalesce(new.type::text, ''))) = 'take away'
    and new.status::text = 'Dibatalkan'
    and btrim(coalesce(new.cancel_reason, '')) ~* '^Pesanan Takeaway kedaluwarsa otomatis karena belum dibayar[.]?$'
  then
    raise exception using errcode = '23514',
      message = 'TAKEAWAY_AUTO_EXPIRY_DISABLED: Pesanan Take Away tidak boleh dibatalkan otomatis karena belum dibayar.',
      hint = 'Muat ulang semua aplikasi POS dan Take Away ke versi terbaru.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reject_retired_takeaway_expiry on public.orders;
create trigger trg_reject_retired_takeaway_expiry
before insert or update of source, type, status, cancelled_at, cancel_reason on public.orders
for each row execute function public.reject_retired_takeaway_expiry();

create or replace function public.guard_active_takeaway_stock_restore()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if old.restored_at is null and new.restored_at is not null
    and coalesce(current_setting('kasirin.takeaway_restore_intent', true), '') <> new.order_number
    and exists (
      select 1 from public.orders o
      where o.order_number = new.order_number
        and o.order_number ~* '^T[0-9]+$'
        and o.source = 'Self Order' and o.type::text = 'Take Away'
        and o.status::text <> 'Dibatalkan'
    )
  then
    -- The exception rolls back the entire restore RPC, including product/movement writes.
    raise exception using errcode = '23514',
      message = 'TAKEAWAY_AUTO_EXPIRY_DISABLED: Stok pesanan Take Away aktif tidak boleh dikembalikan oleh alur lama.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_active_takeaway_stock_restore on public.limited_stock_commits;
create trigger trg_guard_active_takeaway_stock_restore
before update of restored_at on public.limited_stock_commits
for each row execute function public.guard_active_takeaway_stock_restore();

create or replace function public.restore_takeaway_stock_with_intent(p_order_number text, p_intent text)
returns table(restored boolean, reason text)
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  previous_intent text := coalesce(current_setting('kasirin.takeaway_restore_intent', true), '');
begin
  if p_intent is null or p_intent not in ('manual_delete', 'submit_failed') then
    raise exception using errcode = '22023', message = 'Alasan pengembalian stok tidak valid.';
  end if;
  perform set_config('kasirin.takeaway_restore_intent', p_order_number, true);
  return query select r.restored, r.reason from public.restore_limited_stock_commit(p_order_number) r;
  perform set_config('kasirin.takeaway_restore_intent', previous_intent, true);
end;
$$;

create or replace function public.cancel_takeaway_pay_later_order(p_order_number text, p_reason text)
returns table(order_id uuid, stock_restored boolean)
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  target public.orders%rowtype;
  did_restore boolean;
begin
  if nullif(btrim(p_reason), '') is null
    or btrim(p_reason) ~* '^Pesanan Takeaway kedaluwarsa otomatis karena belum dibayar[.]?$'
  then
    raise exception using errcode = '22023', message = 'Alasan pembatalan manual wajib diisi.';
  end if;
  select o.* into target from public.orders o where o.order_number = p_order_number for update;
  if not found or target.source <> 'Self Order' or target.type::text <> 'Take Away'
    or target.order_number !~* '^T[0-9]+$' then
    raise exception using errcode = '22023', message = 'Pesanan Take Away tidak ditemukan.';
  end if;
  if target.status::text not in ('Pesanan Baru', 'Dibatalkan') then
    raise exception using errcode = '23514', message = 'Status pesanan telah berubah. Muat ulang sebelum membatalkan.';
  end if;
  if target.status::text = 'Dibatalkan' and coalesce(target.cancel_reason, '') <> btrim(p_reason) then
    raise exception using errcode = '23514', message = 'Pesanan sudah dibatalkan dengan alasan lain.';
  end if;
  update public.orders o set status = 'Dibatalkan', cancelled_at = coalesce(o.cancelled_at, now()),
    cancel_reason = btrim(p_reason), updated_at = now() where o.id = target.id;
  select r.restored into did_restore from public.restore_limited_stock_commit(p_order_number) r;
  return query select target.id, coalesce(did_restore, false);
end;
$$;

revoke all on function public.restore_takeaway_stock_with_intent(text, text) from public;
revoke all on function public.cancel_takeaway_pay_later_order(text, text) from public;
grant execute on function public.restore_takeaway_stock_with_intent(text, text) to anon, authenticated;
grant execute on function public.cancel_takeaway_pay_later_order(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
