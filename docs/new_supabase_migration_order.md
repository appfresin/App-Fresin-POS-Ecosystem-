# Migrasi Database Supabase Baru

Target project:

- URL: `https://pjkotqianxecaawqompo.supabase.co`
- Frontend hanya boleh memakai `anon` key.
- Jangan simpan `service_role` key di source code, `app.js`, atau folder `deploy-ready`.

## Status Cek Awal

- Anon key project baru valid.
- Database baru belum memiliki tabel aplikasi, contoh `public.store_settings` masih belum ada.
- `psql` dan Supabase CLI belum tersedia di mesin ini, jadi SQL perlu dijalankan dari Supabase SQL Editor atau memakai database connection string.

## Urutan SQL Editor

Opsi praktis: untuk menjalankan semuanya sekali paste, gunakan file gabungan:

- `docs/new_supabase_full_migration_once.sql`

Jika ingin menjalankan bertahap, jalankan file berikut satu per satu di Supabase SQL Editor project baru:

1. `docs/supabase_schema.sql`
2. `docs/supabase_full_integration_migration.sql`
3. `docs/self_order_settings_sync.sql`
4. `docs/addon_sold_out_foundation.sql`
5. `docs/stock_inventory_foundation.sql`
6. `docs/fcm_push_notifications.sql`
7. `docs/report_profit_summary_views.sql`
8. `docs/public_report_read_policy.sql`
9. `docs/supabase_realtime_enable.sql`
10. `supabase/migrations/202608010001_stock_audit_movements_realtime.sql`
11. `supabase/migrations/202608030001_limited_stock_reservations.sql`
12. `supabase/migrations/202608030002_operational_cleanup.sql`
13. `supabase/migrations/202608050001_device_push_kitchen_categories.sql`
14. `supabase/migrations/202608050002_report_paid_at_order.sql`
15. `supabase/migrations/202608050003_mixed_payment_breakdown.sql`
16. `supabase/migrations/202608060001_server_time.sql`
17. `supabase/migrations/202608120001_push_notification_delivery_timeout.sql`
18. `supabase/migrations/202608130001_order_notification_reminder_status.sql`
19. `supabase/migrations/202608130002_order_push_notification_categories.sql`
20. `supabase/migrations/202608140001_so_takeaway_payment_gate.sql`

Jika aplikasi memang tetap mode lokal/simple dengan anon key tanpa login, jalankan terakhir:

21. `docs/disable_rls_for_local_app.sql`

## Setelah SQL Berhasil

1. Deploy edge functions `notify-new-order` dan `register-device-token` ke project baru.
2. Set secret/function env di project baru sesuai `docs/fcm_push_notifications_setup.md`.
3. Baru ubah `SUPABASE_URL` dan `SUPABASE_ANON_KEY` di aplikasi serta folder deploy ke project baru.
4. Uji POS, Self Order, Takeaway, dapur, pembayaran, hapus transaksi owner, dan laporan.
