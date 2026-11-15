# Pickup dan delivery: pembayaran langsung

Status 12 November 2026: kode dan paket frontend sudah diperbarui. Migrasi dan
Edge Function di bawah **belum dipasang ke proyek Fresin** karena koneksi akun
yang tersedia belum memuat proyek `pjkotqianxecaawqompo`.

## Alur

- Pickup: pelanggan mengirim pesanan beserta jam pengambilan opsional. Pesanan
  muncul belum lunas di kasir. Kasir menekan **Proses Pesanan** untuk meneruskannya
  ke dapur. Pelanggan membayar di outlet saat mengambil pesanan.
- Delivery: cari kurir terlebih dahulu. Setelah kurir menerima tugas, pesanan
  muncul di POS. Di aplikasi driver tersedia **Konfirmasi WhatsApp** dan
  **Proses Pesanan**. Tombol proses mengisi `confirmed_at` dan langsung melepas
  pesanan ke antrean dapur tanpa tahap penerimaan kasir. Tombol ini hanya berlaku
  untuk pesanan delivery tunai yang masih baru dan ditugaskan kepada driver itu.
  Pelunasan tetap dicatat terpisah oleh kasir. Kurir membayar **harga produk**
  ke outlet sebelum membawa pesanan. Pelanggan membayar produk + ongkir kepada
  kurir. Ongkir menjadi pendapatan langsung kurir dan tidak masuk klaim saldo.
- `grand_total` tetap menyimpan jumlah yang dibayar pelanggan. Pembayaran POS,
  struk kasir, dan laporan pendapatan outlet hanya menghitung harga produk untuk
  `courier_cash`. Migrasi memperbaiki view laporan tanpa menghapus dependensinya.
- Provider baru: `cash_at_outlet` untuk pickup, `courier_cash` untuk delivery.
  Pesanan Duitku yang sudah ada tidak diubah menjadi pesanan tunai otomatis.
- Card POS menampilkan nama pemesan dan chip **Delivery**, **Takeaway-Rumah**,
  atau **Takeaway Outlet**. Pickup dari QR outlet membawa `origin=outlet` ke
  `/pesan/` dan menyimpan asal di `service_info`; pickup langsung dari rumah
  menyimpan `Takeaway-Rumah`. Pesanan takeaway lama tetap dikenali sebagai outlet.
- Detail driver menampilkan catatan pelanggan tanpa penjelasan pembayaran yang
  ditambahkan sistem, serta jumlah di kiri produk dan harga baris di kanan.
  Ikon kirim di samping **Buka Maps** membuka pemilih aplikasi berbagi perangkat;
  browser yang tidak mendukungnya menyediakan WhatsApp dan salin tautan.
- Ikon kirim di samping nomor pelanggan membagikan nama dan nomor WhatsApp.
  Tombol **Bagikan** pada header detail membagikan ringkasan terstruktur yang
  memuat status, item, harga, pembayaran, patokan, tautan lokasi, catatan pelanggan,
  dan driver. Fallback WhatsApp dan salin teks mempertahankan baris serta jarak
  antarbagian. Konfirmasi WhatsApp memakai patokan dan tautan lokasi, tanpa baris
  alamat/pin yang berulang. Semua pembagian diawali klik pengguna.

Checkout memakai service strip yang sama dengan menu, label normal, jam
pengambilan, dan tombol **Buat Pesanan**. Hasil pemesanan memakai komponen sukses,
detail, dan progres SO Takeaway yang sudah ada. Guard pengiriman terkonfirmasi,
stok, serta perlindungan penimpaan pembayaran/item tetap berlaku.

## Aktivasi server sebelum rollout

1. Sambungkan akun pemilik App Fresin POS dan pastikan proyek yang dipilih
   `pjkotqianxecaawqompo`.
2. Periksa struktur `orders`, definisi `kasirin_notify_order_push()`, trigger
   terkait, dan view `report_sales_records` yang sedang aktif.
3. Terapkan `supabase/migrations/20261112053635_customer_cash_at_outlet.sql` melalui
   migrasi Supabase. Migrasi mempertahankan notifikasi legacy, mengirim notifikasi
   kasir sebelum penerimaan/dapur setelah penerimaan, melarang expiry pembayaran
   online pada pesanan tunai, dan menolak delivery keluar sebelum produk lunas.
4. Deploy pembaruan `supabase/functions/create-duitku-payment/index.ts` agar server
   menolak pembuatan Duitku untuk provider tunai. Integrasi Duitku lama tetap ada.
5. Upload frontend `deploy-ready` dan muat ulang POS, halaman pelanggan, serta
   aplikasi driver. Migrasi/Edge Function tidak terpasang hanya dengan mengunggah
   folder frontend ke GitHub/Vercel.

Tidak ada pesanan, pelunasan, atau pembatalan produksi yang dibuat oleh uji ini.

## Pengujian

```powershell
node --test tests/*.test.js
node tools/test-customer-gateway-browser.mjs
node tools/test-customer-gateway-browser.mjs --cash-only
# Memerlukan @electric-sql/pglite pada folder QA sementara, atau FRESIN_PGLITE:
node tools/test-customer-cash-db.mjs
```

Database QA berjalan dalam memori, memakai stub `net.http_post`, dan tidak
menghubungi proyek Supabase. Uji mencakup migrasi berulang, notifikasi berdasarkan
penerimaan, guard pelunasan, laporan produk tanpa ongkir, dan preservasi legacy.
Browser QA memakai fixture lokal. Live view hanya diperiksa sampai checkout.
Driver hanya mendapat tombol **Ambil ke outlet** setelah status dapur siap
(`Selesai`, `Siap Diambil`, `ready_at`, atau status pickup yang sesuai). Sebelum
itu, daftar dan detail menampilkan keterangan menunggu dapur. Setelah siap,
card menampilkan pemberitahuan selesai disiapkan. Guard aksi dan kondisi update
memeriksa driver, status dapur, status delivery, serta syarat pembayaran produk;
perubahan status dapur yang bersamaan tidak boleh dilewati lewat tombol lama.
