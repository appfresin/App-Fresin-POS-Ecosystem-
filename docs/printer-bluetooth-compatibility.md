# Cetak Bluetooth POS v1.7

Tanggal: 10 November 2026.

Implementasi membandingkan jalur Fresin dengan referensi lokal
`D:/File Aplikasi Develop/SEBLAK POS/android-app/app/src/main/java/com/seblakpos/app/MainActivity.java`.
Fresin sebelumnya membagi data menjadi 4.096 byte tanpa pacing/drain; koneksi
langsung ditutup setelah penulisan. Itu adalah perbedaan kode yang teramati,
bukan bukti tunggal penyebab masalah fisik printer pengguna.

Versi baru:

- Semua byte cetak, termasuk logo, dikirim maksimal 128 byte per bagian.
- Setiap bagian di-flush; jeda antarbagiannya 20 ms dan jeda akhir 300 ms sebelum
  stream/socket ditutup. Nilai ini titik awal yang perlu diuji per model printer.
- Koneksi SPP secure dicoba lebih dahulu. Bila gagal sebelum pengiriman,
  socket ditutup dan dicoba insecure SPP. Byte yang sudah dikirim tidak diulang.
- Seluruh proses berada pada thread printer dengan pengaman satu cetakan aktif.
- Font, ukuran, jarak karakter dan jarak baris direset pada awal struk.
- Tidak ada perintah cut. Toast sukses menyatakan data terkirim; printer tidak
  memberikan konfirmasi hasil kertas melalui jalur ini.
- Gangguan pengiriman tidak otomatis membuka jalur cetak lain yang berisiko
  menggandakan struk setelah sebagian byte diterima. Jalur Android Print
  Framework tetap tersedia untuk cetak HTML/non-Bluetooth.

## Pilihan per perangkat

Setelah deploy `deploy-ready` dan memasang APK v1.7, buka Pengaturan → Printer:

1. **Format lengkap (logo dan teks tebal)** adalah default, memakai renderer
   yang sudah ada. Logo dan pengaturan isi struk tetap tersedia.
2. **Teks kompatibel (tanpa logo gambar)** memakai teks berkolom dari web,
   normalisasi LF/ASCII, tanpa logo bitmap atau perintah tebal. Nama panjang
   dibungkus dan nominal diratakan oleh formatter bersama yang sudah ada.

Pilihan mode ikut preferensi printer lokal, tidak disinkron ke toko/Supabase.
Data lama tanpa pilihan mode tetap memakai format lengkap. 58 mm tetap 31
karakter dan 80 mm 42 karakter mengikuti pengaturan lebar struk yang sudah ada.
Huruf beraksen yang dapat dinormalisasi ditransliterasi ke ASCII; simbol lain
di luar ASCII tidak dicetak pada jalur teks ini.

APK v1.7 diperlukan untuk pacing, retry koneksi dan mode teks. Pembaruan web
saja tidak mengganti kode Bluetooth di APK lama. APK memuat situs online;
deployment web diperlukan agar pemilih mode muncul. Bluetooth BLE-only belum
didukung; jalur ini memakai Bluetooth Classic SPP.

## Verifikasi otomatis

- 198 tes aplikasi lulus, termasuk isolasi preferensi antarperangkat, mode cetak,
  struk 40 item, nama panjang, dan pemertahanan nominal dalam 31 kolom.
- 13 unit test Android lulus: 11 transport Bluetooth dan 2 kebijakan URL.
- Build APK berhasil; lint Android 0 error, 55 warning.
- JaCoCo pada `ReceiptBluetoothTransport`: 88,2% instruksi, 90,0% cabang dan
  97,1% baris. Laporan: `APK/KasirinWebView/qa-results/printer-v1.7-coverage.xml`.
- Pengujian tidak memakai printer fisik, tidak membuat transaksi produksi dan
  tidak membuktikan kompatibilitas seluruh model. Tes emulator fullscreen
  v1.6 tidak dijalankan ulang pada v1.7; konfigurasi fullscreen dipertahankan
  dan pengamannya diperiksa oleh tes kode aplikasi.

## Uji kertas di toko

Coba masing-masing mode pada printer yang benar-benar dipakai. Catat model
printer dan versi Android/APK agar parameter dapat disesuaikan bila perlu.

| Skenario | Yang diperiksa |
| --- | --- |
| Satu item | Kolom nominal, ukuran huruf, jarak baris |
| Banyak item | Baris tidak hilang/terpotong, total lengkap |
| Nama item panjang | Pembungkusan dan nominal tidak bertabrakan |
| Logo pada format lengkap | Logo selesai sebelum teks, jarak di bawah logo |
| Beberapa struk berurutan | Setiap hasil konsisten, koneksi boleh selesai dahulu |
| Bluetooth diputus saat mengirim | Pesan gangguan jelas; periksa kertas sebelum mencetak ulang |

Rujukan primer:
[Android RFCOMM/SPP](https://developer.android.com/reference/android/bluetooth/BluetoothDevice#createInsecureRfcommSocketToServiceRecord(java.util.UUID)),
[Epson ESC 2 untuk jarak baris](https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/esc_2.html),
[Epson GS ! untuk ukuran karakter](https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/gs_exclamation.html).
