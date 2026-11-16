-- Exercise the installed trigger using a temporary table. No real orders change.
begin;
create temporary table takeaway_identity_guard_test (
  order_number text, created_at timestamptz, public_order_token text, status text
);
create trigger guard_takeaway_order_identity
before update of order_number, created_at, public_order_token on takeaway_identity_guard_test
for each row execute function public.guard_takeaway_order_identity();
insert into takeaway_identity_guard_test values
  ('T999999999999999999', '2026-11-16T04:19:00Z', 'synthetic-token', 'Pesanan Baru');
-- The cashier may update status while preserving the order's original identity.
update takeaway_identity_guard_test set status='Sedang Disiapkan',
  created_at=created_at, public_order_token=public_order_token;
do $$
begin
  begin
    update takeaway_identity_guard_test set created_at='2026-11-16T04:25:00Z';
    raise exception 'FAIL: a new checkout overwrote an earlier creation time';
  exception when check_violation then
    if sqlerrm <> 'Identitas pesanan Take Away tidak dapat ditimpa oleh pesanan lain.' then raise; end if;
  end;
  begin
    update takeaway_identity_guard_test set public_order_token='different-customer';
    raise exception 'FAIL: a new customer overwrote the creation token';
  exception when check_violation then
    if sqlerrm <> 'Identitas pesanan Take Away tidak dapat ditimpa oleh pesanan lain.' then raise; end if;
  end;
  begin
    update takeaway_identity_guard_test set order_number='T999999999999999998';
    raise exception 'FAIL: a checkout overwrote the original number';
  exception when check_violation then
    if sqlerrm <> 'Identitas pesanan Take Away tidak dapat ditimpa oleh pesanan lain.' then raise; end if;
  end;
  -- Token-less legacy orders receive the same creation-time protection.
  insert into takeaway_identity_guard_test values ('T999999999999999997', '2026-11-16T04:19:00Z', null, 'Pesanan Baru');
  begin
    update takeaway_identity_guard_test set created_at='2026-11-16T04:25:00Z'
      where order_number='T999999999999999997';
    raise exception 'FAIL: an older cached client overwrote the legacy order';
  exception when check_violation then
    if sqlerrm <> 'Identitas pesanan Take Away tidak dapat ditimpa oleh pesanan lain.' then raise; end if;
  end;
end;
$$;
rollback;
select 'PASS: valid status updates allowed; order identity and legacy checkout collisions protected' as result;
