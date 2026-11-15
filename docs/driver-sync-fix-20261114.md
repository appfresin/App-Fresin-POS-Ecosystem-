# Perbaikan konsistensi driver â€” 14 November 2026

Pengguna sudah mengizinkan publikasi. Backend produksi telah diperbarui pada 14 November 2026; web sudah dipublikasikan melalui commit GitHub `5b67534`; deployment Vercel sukses.

## Kemajuan koneksi dan publikasi

- OAuth MCP `supabase-fresin` berhasil login untuk project `pjkotqianxecaawqompo`. Akses proyek, tabel, SQL, advisories, logs, dan Edge Function telah terverifikasi melalui sesi MCP resmi tanpa mengekspor credential.
- Backup definisi fungsi dan source Edge Function sebelum perubahan tersedia di `runtime-backup-20261114-driver-publish/` (lokal, tidak dimasukkan ke repo hosting).
- Edge Function `notify-new-order` versi 5 ACTIVE, tetap `verify_jwt=false` dengan autentikasi secret internal yang sudah ada. Kedua file source hasil deployment cocok dengan lokal.
- Migrasi produksi sukses: `20261114071359 driver_publish_prerequisites`, `20261114071414 driver_native_notifications`, `20261114071429 driver_feed_consistency`. Prasyarat autentikasi staff dan notifikasi tunai ternyata belum terpasang; bridge memasangnya sambil mempertahankan isi fungsi prepaid lama. Patch entry point dibuat kompatibel dengan format baris fungsi produksi.
- RPC feed teruji dengan role anon dan capability valid dalam transaksi rollback. Perangkat/PIN tidak valid ditolak dengan 28000; direct REST tabel perangkat ditolak; RLS tabel perangkat aktif, tidak ada akses SELECT anon/authenticated atau EXECUTE PUBLIC pada feed. Tidak ada perangkat uji yang tersisa.
- Perangkat push terdaftar masih 0 saat verifikasi. Registrasi HP dan pengiriman FCM nyata belum diuji.
- Repo `https://github.com/appfresin/App-Fresin-POS-Ecosystem-`, branch `main`, basis `6641ea2`. Checkout `%TEMP%/fresin-publish-20261114` memuat commit lokal `5b67534` (13 file). Push main sukses. Deployment Vercel DJPNWQ7T75geDkmC3wXPLhYPPSHP selesai; 13/13 file produksi sama dengan paket lokal. Probe POS produksi memastikan order sebelum Proses tersembunyi dan setelah Proses terlihat.
- Audit menemukan RLS dinonaktifkan pada 36 tabel aplikasi lama. Tidak diubah otomatis karena perlu kebijakan akses yang kompatibel dengan POS. Ini temuan keamanan lama yang perlu penanganan terpisah; tabel perangkat baru tetap privat.

## Temuan yang terverifikasi

- Aset `driver-order.js`, `driver-notifications.js`, dan `driver-refresh.css` pada website sebelum perubahan ini identik dengan versi lokal. Perbedaan tampilan pesanan bukan sekadar perbedaan ketiga file tersebut.
- Permintaan REST memakai anon key aplikasi hanya mengembalikan D001; live view/customer sebelumnya menampilkan D005. Pemeriksaan administrator selanjutnya juga hanya menemukan satu order delivery pada database. RLS tabel lama nonaktif, sehingga penyebab perbedaan yang dilaporkan belum terbukti berasal dari RLS. Feed baru menyatukan sesi akun; pencocokan order baru HP/live view masih perlu diuji pengguna.
- Probe tabel `driver_push_devices` menghasilkan PGRST205 (tabel tidak ada dalam schema cache). Pesan PIN/aktivasi pada screenshot konsisten dengan layanan registrasi yang belum diterapkan.
- Koneksi Supabase awal hanya memiliki akses ke proyek lain. Koneksi OAuth khusus Fresin sekarang sudah digunakan untuk deployment dan verifikasi.

## Perubahan

- Feed `driver_order_feed` memeriksa capability perangkat dan akses staff aktif di server. Data tidak bergantung pada Supabase Auth POS yang mungkin tersimpan pada browser/WebView tertentu. Feed hanya mengembalikan kolom yang dibutuhkan driver, tawaran belum ditugaskan, dan pesanan yang menjadi hak akun tersebut; tidak mengembalikan public order token.
- Verifikasi PIN membuat capability perangkat dengan secret acak 256-bit, hash di server, kedaluwarsa 30 hari. Browser dapat menggunakan akun driver tanpa mendaftarkan token push palsu. PIN tidak disimpan.
- Feed mengutamakan tugas aktif driver dan memakai satu snapshot query. Selama server belum dipasang, kode mempertahankan jalur lama dengan pesan bahwa sinkronisasi akun belum aktif. Kegagalan query riwayat tidak membuang hasil tugas aktif.
- Respons dari akun yang telah keluar tidak dapat menimpa akun baru. Event realtime yang datang saat fetch sedang berjalan dijadwalkan ulang. ID penugasan menjadi acuan utama, sehingga nama yang sama tidak menganggap order orang lain sebagai milik driver.
- Batal/terlewat hanya tampil di filter Batal; filter Aktif tidak menyertakannya.
- Delivery tunai hanya terlihat di POS setelah kurir memprosesnya (`confirmed_at` atau progres dapur). Patch server menahan notifikasi kasir sebelum konfirmasi kurir, dengan mempertahankan isi fungsi notifikasi produksi lainnya.
- Tombol GPS baru berada di atas tombol penetapan lokasi dan tetap bisa dipakai ketika pin sebelumnya sudah dikonfirmasi.
- Header web lebih pendek. APK 1.8 mewarnai area cutout/status bar native dengan hijau header tanpa menggandakan padding safe-area pada header web.

## Aktivasi dan verifikasi berikutnya

1. Backend sudah diperbarui: prasyarat `20261114071137_driver_publish_prerequisites.sql`, lalu `20261114011051_driver_native_notifications.sql`, dan `20261114045609_driver_feed_consistency.sql`. Migrasi prasyarat hanya memasang autentikasi staff dan notifikasi tunai, bukan mengganti view laporan atau RLS tabel lama.
2. Edge Function versi 5 sudah aktif. Konfigurasi service-account/secret internal POS dipertahankan.
3. Publikasi GitHub/Vercel dan verifikasi 13 file produksi sudah selesai pada https://www.fresin.id/.
4. Pasang APK Anterin 1.8 di atas versi driver sebelumnya. Application ID `.driver` tetap terpisah dari POS.
5. Verifikasi PIN driver di masing-masing browser/HP. Periksa bahwa D005/order baru muncul sesuai penugasan dan bahwa order pra-Proses tidak muncul di POS.
6. Uji push nyata saat background/swipe-away, interval ulang, diterima perangkat lain, batal, expiry, logout dan koneksi terputus. Pengiriman FCM/aktivasi server dan perilaku pada HP belum diuji karena HP belum didaftarkan ulang setelah aktivasi server.

Build APK, unit test dan lint Android lulus. Tes frontend mencakup race pergantian akun, kegagalan riwayat, filter batal, gate POS, dan callback tombol lokasi; pengujian browser dilakukan pada lebar 310/348/402/430 px. SQL/PLpgSQL sudah diterapkan dan diuji di database produksi. Probe capability dilakukan dalam transaksi rollback tanpa mengubah pesanan nyata.
