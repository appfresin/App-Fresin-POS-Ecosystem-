-- Optional: izinkan laporan dibaca tanpa login Supabase.
-- Jalankan ini kalau ingin halaman laporan langsung muncul tanpa login.
-- Ini hanya membuka akses SELECT/read. Import, transaksi, dan edit data tetap perlu login.

grant usage on schema public to anon;
grant select on public.report_sales_records to anon;
grant select on public.report_profit_yearly to anon;
grant select on public.report_profit_monthly to anon;
grant select on public.report_profit_daily to anon;
grant select on public.report_payment_summary_daily to anon;
grant select on public.report_order_type_summary_daily to anon;
grant select on public.report_visitor_summary_daily to anon;
grant select on public.legacy_sales to anon;

drop policy if exists anon_read_legacy_sales on public.legacy_sales;
create policy anon_read_legacy_sales on public.legacy_sales
  for select
  using (true);

drop policy if exists anon_read_orders on public.orders;
create policy anon_read_orders on public.orders
  for select
  using (true);

drop policy if exists anon_read_payments on public.payments;
create policy anon_read_payments on public.payments
  for select
  using (true);
