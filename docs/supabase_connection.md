# Koneksi Aplikasi ke Supabase

## Project

- URL: `https://pjkotqianxecaawqompo.supabase.co`
- Key yang dipakai frontend: anon public key

Anon key aman dipakai di frontend selama RLS aktif. Jangan gunakan `service_role` key di aplikasi/browser.

## Alur Pakai

1. Buat user admin di Supabase Dashboard melalui menu Authentication.
2. Buka aplikasi Kasirin!.
3. Masuk ke halaman Settings.
4. Login di panel `Sinkronisasi Supabase`.
5. Setelah status terhubung, import Excel lama dari panel `Import Database Kasir Lama`.
6. Transaksi baru dari kasir akan mencoba tersimpan ke Supabase otomatis.

## Tabel yang Diisi Otomatis

Import Excel lama:

- `legacy_sales_imports`
- `legacy_sales`

Transaksi baru:

- `staff_profiles`
- `orders`
- `order_items`
- `order_item_addons`
- `payments`

## Catatan

Data tetap disimpan lokal terlebih dahulu agar aplikasi tidak berhenti saat koneksi internet bermasalah. Jika belum login Supabase, import Excel dan transaksi baru tetap masuk ke localStorage, tetapi belum terkirim ke database online.
