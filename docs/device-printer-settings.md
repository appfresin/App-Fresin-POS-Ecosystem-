# Pilihan printer per perangkat

Masalah yang dikonfirmasi pada 9 November 2026: pemilihan printer untuk pengujian
di HP mengubah printer tablet kasir, walaupun staf yang masuk berbeda.

Penyebabnya adalah `store_settings.self_order_settings.printer`. Identitas toko
dipakai bersama semua staf/perangkat. Sebelumnya pemindaian dan penyimpanan
printer menulis ke baris itu, lalu pembacaan settings menimpa pilihan lokal.

Perbaikan aplikasi:

- Nama, koneksi, dan alamat printer disimpan pada perangkat/browser tersebut
  menggunakan `kasirin_device_printer_v1`, serta state lokal/IndexedDB.
- Normalisasi settings tidak lagi membaca pilihan printer dari Supabase.
- Payload settings toko tidak lagi memuat identitas printer. Pengaturan format
  struk, lebar kertas, logo dan isi struk tetap mengikuti jalur bersama yang ada.
- Memilih atau menyimpan printer tidak melakukan update settings Supabase.
- Saat state dipulihkan atau akun berganti, preferensi printer perangkat tetap
  diutamakan. Pilihan lokal lama dipertahankan sebagai migrasi awal; aplikasi
  tidak dapat menebak pilihan yang benar jika sebelumnya sudah tertimpa.
- Jika alamat web kosong, key alamat tidak dikirim agar APK lama dapat memakai
  printer default dari penyimpanan native-nya sendiri.

Tambahan v1.7: `printerPrintMode` juga disimpan lokal. Nilai `formatted` menjaga
format lengkap sebagai default, sedangkan `text` memilih teks kompatibel.
Preferensi v1 lama tanpa field tersebut tetap dibaca dengan default format lengkap.

Tidak ada perubahan skema atau perintah SQL yang perlu dijalankan. Field lama
di cloud diabaikan oleh versi baru. Client yang belum memuat web terbaru masih
memiliki perilaku lama, sehingga setiap perangkat perlu membuka ulang aplikasi
setelah deployment. Parameter cache aset dinaikkan dengan `device-printer1`.

Setelah deploy `deploy-ready`, pilih ulang printer toko di tablet kasir melalui
Pengaturan → Printer → Pindai → Atur Printer, lalu uji struk. Lakukan pemilihan
printer HP secara terpisah. Penghapusan data aplikasi/browser atau pergantian
origin/domain tetap dapat memerlukan pemilihan ulang. Pembaruan APK tidak
diperlukan untuk perubahan web ini.

Uji regresi `tests/device-printer-settings.test.js` mencakup pemuatan setting dari
perangkat lain, pemindaian native/browser, penyimpanan tanpa jaringan, migrasi
lokal/IndexedDB, pergantian akun/state, storage rusak/penuh, payload APK, dan
query update settings tanpa printer. Query integrasi memakai Supabase tiruan;
tidak mengubah database produksi atau mencetak transaksi sungguhan.

Verifikasi: 191 tes aplikasi lulus (termasuk 13 tes printer perangkat), pemeriksaan
sintaks semua varian app lulus. Pengukuran V8 pada empat helper preferensi printer
menunjukkan 98,3% cakupan rentang kode; angka ini khusus helper tersebut, bukan
persentase cakupan seluruh aplikasi. Printer fisik toko belum diuji langsung.
