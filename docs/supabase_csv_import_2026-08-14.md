# Import CSV Supabase Baru - 14 Agustus 2026

Sumber CSV:

- `Databse download 14 agustus`

Target Supabase:

- `https://pjkotqianxecaawqompo.supabase.co`

Skrip import:

- `tools/import-supabase-csv.mjs`

## Hasil Final

- `store_settings`: 1
- `categories`: 15
- `addons`: 11
- `products`: 108
- `product_addons`: 41
- `orders`: 643
- `order_items`: 1902
- `order_item_addons`: 124
- `payments`: 629
- `stock_movements`: 74
- `legacy_sales_imports`: 7
- `legacy_sales`: 75238
- `limited_stock_commits`: 37

## Sengaja Tidak Diimpor

- `staff_profiles`: terkait `auth.users` project lama, sehingga foreign key tidak valid di project baru.
- `device_push_tokens`: terkait user/token lama; perangkat perlu register ulang di project baru.
- `push_notification_logs`: log lama tidak diperlukan untuk operasional.

## Catatan

- Baris seed `store_settings` default `Kasirin!` dari database baru sudah dihapus, sehingga hanya setting lama `Fresin Indonesia` yang tersisa.
- Nilai kosong pada histori order dinormalisasi saat import agar sesuai constraint schema baru.
- `created_by` pada `stock_movements` dan `imported_by` pada `legacy_sales_imports` dikosongkan karena menunjuk user auth project lama.
