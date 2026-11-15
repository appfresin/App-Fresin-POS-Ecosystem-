# Rancangan Database Kasirin! di Supabase

## Prinsip Baru

Aplikasi kasir dipakai untuk **1 outlet = 1 database Supabase**.

Artinya database operasional outlet tidak perlu membawa konsep multi-outlet seperti `organizations`, `outlets`, atau `outlet_id` di semua tabel. Struktur jadi lebih ringan, mudah dibaca, mudah backup, dan lebih aman untuk operasional harian.

Kalau nanti ada 2 outlet atau lebih, setiap outlet tetap punya database sendiri. Dashboard pusat dibuat terpisah untuk membaca atau menerima ringkasan dari beberapa database outlet.

## Database Outlet

File schema utama: `docs/supabase_schema.sql`.

### Setting dan User

- `store_settings`: identitas toko, struk, timezone, dan preferensi outlet.
- `staff_profiles`: user/kasir/admin yang login ke database outlet ini.

### Master Produk

- `categories`: kategori produk.
- `products`: data barang/menu, harga, modal, stok, status habis, channel penjualan, dan varian.
- `addons`: daftar add-on.
- `product_addons`: relasi add-on yang boleh dipakai per produk.

Varian produk disimpan di `products.variant_options` dengan tipe `jsonb`. Ini membuat varian 1 tingkat dan 2 tingkat tetap fleksibel tanpa terlalu banyak tabel.

### Transaksi

- `cash_sessions`: buka/tutup kas.
- `orders`: header transaksi/pesanan.
- `order_items`: item produk dalam transaksi.
- `order_item_addons`: add-on per item.
- `payments`: pembayaran transaksi.

`payments` dibuat terpisah supaya mudah mendukung split payment, pelunasan piutang, atau koreksi pembayaran. Pecahan pembayaran Cash/QRIS disimpan ringan di `payment_breakdown`.

### Stok dan Audit

- `stock_movements`: perubahan stok dari penjualan atau koreksi manual.
- `audit_logs`: catatan aktivitas penting.

### Data Lama dan Laporan

- `legacy_sales_imports`: catatan file Excel lama yang pernah diimpor.
- `legacy_sales`: transaksi historis dari aplikasi kasir lama.
- `report_sales_records`: view gabungan transaksi baru dan transaksi lama.

Halaman laporan sebaiknya membaca `report_sales_records`, sehingga data lama dan data baru terlihat sebagai satu riwayat penjualan.

## Dashboard Pusat Masa Depan

Dashboard pusat tidak perlu masuk ke database outlet. Buat database/project Supabase terpisah khusus owner dashboard.

Pola yang disarankan:

1. Outlet tetap menulis transaksi ke database outlet masing-masing.
2. Setiap outlet mengirim ringkasan harian/bulanan ke database pusat.
3. Dashboard pusat hanya membaca data agregat, bukan mengganggu transaksi kasir.

Contoh data yang dikirim ke pusat:

- omzet harian
- jumlah transaksi
- keuntungan
- metode pembayaran
- tipe pesanan
- produk terlaris
- stok kritis

Detail schema pusat ada di `docs/central_dashboard_schema.sql`.

## Prioritas Implementasi

1. Jalankan `docs/supabase_schema.sql` di Supabase outlet pertama.
2. Buat akun admin outlet di Supabase Auth.
3. Tambahkan baris `staff_profiles` untuk admin itu.
4. Hubungkan aplikasi ke Supabase dari halaman Settings.
5. Migrasi kategori, add-on, dan produk dari localStorage.
6. Simpan transaksi baru ke Supabase.
7. Pindahkan import Excel lama ke tabel `legacy_sales`.
8. Ubah laporan agar membaca view `report_sales_records`.

## Catatan

- Kolom `tax_amount` tetap ada di database, walaupun UI laporan tidak menampilkan pajak.
- `legacy_sales.raw_data` menyimpan baris asli Excel agar data lama tidak hilang.
- RLS awal dibuat sederhana: semua user login bisa mengakses database outlet. Nanti bisa diperketat berdasarkan `staff_profiles.role`.
