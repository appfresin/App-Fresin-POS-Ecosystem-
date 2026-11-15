# Realtime E2E Checklist

Target: validasi multi-device untuk self order, kasir, dan dapur setelah `docs/supabase_realtime_enable.sql` dijalankan.

## Setup

- Buka 3 device/tab berbeda:
  - `self-order.html?table=A-1#selforder`
  - `pos.html#pos`
  - `pos.html#kitchen`
- Pastikan semua memakai project Supabase yang sama dan online.
- Jalankan `docs/supabase_full_integration_migration.sql`, lalu `docs/supabase_realtime_enable.sql`.

## Skenario Wajib

1. Pesanan self order masuk realtime.
   - Dari self order, buat pesanan baru.
   - Expected: pesanan muncul di POS dan Kitchen tanpa refresh manual, maksimal beberapa detik.

2. Checklist dapur realtime.
   - Di Kitchen device A, terima pesanan lalu centang item siap satu per satu.
   - Expected: Kitchen device B dan halaman Orders/POS melihat progress item siap tanpa refresh manual.

3. Status selesai realtime.
   - Di Kitchen, klik selesai setelah semua item dicentang.
   - Expected: semua device melihat status berubah menjadi selesai.

4. Barang habis/tersedia realtime.
   - Di Kitchen, tandai produk atau varian sebagai habis.
   - Expected: item hilang/nonaktif di Self Order dan tidak bisa dipilih di POS.
   - Kembalikan ke tersedia.
   - Expected: item muncul aktif lagi di Self Order dan POS.

5. Traffic padat ringan.
   - Buat 10 pesanan self order berurutan dari dua tab berbeda.
   - Expected: tidak ada duplikasi nomor order di UI aktif, semua pesanan masuk Kitchen/POS, dan tombol UI tetap responsif.

## Catatan Teknis

- Aplikasi memakai debounce realtime agar event bertubi-tubi dari `orders`, `order_items`, `payments`, dan `products` tidak memicu render berlebihan.
- Fallback `BroadcastChannel`/`localStorage` membantu multi-tab lokal, tetapi antar-device tetap membutuhkan Supabase Realtime.
