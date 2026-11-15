# Notifikasi native Anterin Delivery

Backend produksi diaktifkan pada 14 November 2026: tiga migrasi driver dan Edge Function `notify-new-order` versi 5 sudah terpasang dan diverifikasi. Web sudah dipublikasikan melalui GitHub/Vercel; registrasi HP dan push nyata masih perlu diuji. Lihat `docs/driver-sync-fix-20261114.md` untuk status rinci.

## Yang tersedia

- Titik tiga di header membuka Dering & notifikasi; preferensi tersimpan otomatis per perangkat.
- Notifikasi aktif/nonaktif, bunyi, getaran, nada Bell/Chime/Lembut, tes bunyi, dan ulang setiap 15â€“120 detik (default 30).
- Browser menggunakan banner dan pengulangan lokal selama halaman berjalan. Android memakai FCM dan foreground service yang hanya hidup selama tawaran delivery masih berlaku.
- Versi tawaran/pembatalan disimpan di perangkat agar push usang tidak memulai dering lagi setelah proses Android dibuat ulang. Pada Anterin 1.10, tombol **Hentikan dering** di notifikasi menghentikan bunyi dan getaran saat itu. Pengulangan berikutnya tetap mengikuti interval yang dihitung dari awal dering terakhir selama tawaran masih tersedia. Dering berakhir saat tawaran diterima, dibatalkan, atau kedaluwarsa, serta saat notifikasi dimatikan atau driver keluar dari akun. Tombol Lihat membuka rincian tawaran.
- Android mengatur bunyi lewat volume notifikasi; mode senyap, DND, izin dan pembatasan baterai tetap berlaku. Force Stop dari Settings Android mencegah FCM sampai aplikasi dibuka kembali. Tidak ada jaminan real-time ketika perangkat offline; expiry lokal tetap membatasi dering.

## Alur dan egress

`orders â†’ trigger â†’ notify-new-order (target driver) â†’ FCM â†’ DriverAlertService`

Pesan berisi ID/kode pesanan, versi, dan waktu kedaluwarsa; tidak membawa telepon/alamat pelanggan. Dering berulang berjalan lokal tanpa polling database. Push penghentian dikirim saat tawaran berakhir. Panggilan tambahan terjadi ketika mendaftarkan/menyegarkan token dan saat pengguna membuka data pesanan. FCM bisa dipengaruhi kondisi jaringan/perangkat. Jika Android menolak menjalankan layanan foreground, aplikasi mencoba menampilkan notifikasi biasa; pengulangan per detik tidak dijamin dalam keadaan itu.

## Aktivasi perangkat

1. Terapkan `supabase/migrations/20261114011051_driver_native_notifications.sql` dengan prasyarat SQL staff driver dan FCM POS yang sudah ada. Terapkan juga `supabase/migrations/20261114045609_driver_feed_consistency.sql` setelahnya untuk sesi data driver dan gate POS. Prasyarat yang sebelumnya belum ada dipasang melalui `20261114071137_driver_publish_prerequisites.sql`; ketiganya sudah aktif di produksi.
2. Publikasikan `supabase/functions/notify-new-order`, termasuk `driver-push.mjs`. Ia menggunakan konfigurasi Firebase dan secret internal POS yang sudah ada. Jangan mengganti `register-device-token` atau tabel token POS.
3. Publikasikan aset web `driver/` dan koreksi progres pelanggan dari `deploy-ready`. APK memuat `https://www.fresin.id/driver/`; ia tidak membundel website lokal.
4. Build `APK/KasirinWebView/BUILD-DRIVER-APK.ps1`. APK memiliki application ID `com.kasirin.webview.driver`, jadi dapat dipasang bersama APK POS.
5. Pastikan aplikasi Android driver beserta signing certificate diizinkan dalam proyek/API-key Firebase. Build memakai konfigurasi proyek Firebase yang ada; konfigurasi client untuk paket driver perlu diverifikasi sebelum uji push HP. Bila diperlukan, letakkan resource `kasirin_firebase_*` untuk Android client driver di `app/src/driver/res/values/` tanpa memasukkan service-account ke APK.
6. Login akun staff yang berhak Driver. Untuk sesi lama, buka pengaturan dan verifikasi PIN agar perangkat terdaftar. PIN tidak disimpan oleh modul push. Pendaftaran berikutnya memakai capability acak perangkat yang disimpan privat dan hash-nya di database; masa sesi 30 hari, diperpanjang saat registrasi.
7. Izinkan notifikasi Android. Halaman pengaturan membedakan izin Android, terdaftarnya perangkat, dan mode browser; tidak mengklaim push aktif bila registrasi server gagal.

## Verifikasi sebelum dipakai operasional

Uji pada HP: order baru saat foreground/background/swipe-away; pengulangan 15/30 detik; ambil di perangkat lain; batal; retry pencarian; expiry 5 menit; logout; notifikasi dimatikan; tidak ada internet; Android DND; dan notification channel diblokir. Periksa bahwa POS tetap menerima notifikasi miliknya dan tidak menerima tawaran driver. Berkas native sudah melalui build/unit test/lint; source Edge Function dan pembatasan RPC sudah diverifikasi di produksi. Pengiriman FCM nyata dan perilaku HP menunggu registrasi perangkat serta uji pengguna.

Table `driver_push_devices` tidak dapat dibaca/ditulis langsung oleh anon/authenticated. RPC registrasi memeriksa PIN atau capability perangkat dan memvalidasi ulang akses staff. Cabang pengiriman driver hanya menerima secret internal server; ia membaca ulang keadaan order untuk menolak offer usang. Preferensi dan capability driver tidak dicadangkan otomatis oleh APK driver.
