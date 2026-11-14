# Deploy Ready

Folder ini berisi paket aplikasi Fresin untuk satu domain. Pintu masuk pelanggan
adalah `/pesan/`, dengan pilihan Ambil di toko atau Diantar sebelum membuka menu.

## Struktur

- `pesan/`
  Halaman pelanggan Fresin App. Memakai aset bersama dari `delivery/` dan `Customer Gateway/`.

- `Customer Gateway/`
  Gerbang pemilihan layanan Signature yang juga dipakai tautan Take Away dan Delivery lama.

- `pos/`
  Aplikasi kasir, admin, dapur, pesanan, produk, laporan, dan settings.

- `self-order/`
  Jalur self order/QR meja dan Take Away outlet. QR meja tetap memakai alur Dine In.

- `delivery/`
  Alur delivery dan pickup dari rumah beserta checkout, pembayaran, driver, dan pelacakan.

- `driver/`
  Aplikasi operasional driver.

## Cara Deploy

Penting: Vercel mencari `index.html` di root yang dideploy. Jika kamu upload folder `deploy-ready` sebagai folder di repo, root domain akan `404` kecuali Vercel root directory diarahkan ke `deploy-ready`.

Upload isi folder `deploy-ready/` ke root repo, atau set **Root Directory** Vercel ke `deploy-ready`.
Pertahankan seluruh subfolder karena halaman pelanggan memakai aset bersama;
mengunggah hanya `pesan/` atau `self-order/` tidak cukup. Root domain diarahkan
ke `/pesan/`; kasir tetap dibuka melalui `/pos/`.

Contoh URL:

- `https://domain-kamu.com/pos/`
- `https://domain-kamu.com/pesan/`
- `https://domain-kamu.com/self-order/?1`

## URL QR Meja

Untuk QR meja, gunakan format pendek berikut agar ganti nomor meja cukup mengganti angka:

```text
https://domain-kamu.com/self-order/?1
https://domain-kamu.com/self-order/?2
...
https://domain-kamu.com/self-order/?20
```

Format lain yang juga didukung:

```text
https://domain-kamu.com/self-order/?m=1
https://domain-kamu.com/self-order/1
https://domain-kamu.com/self-order/?table=A-1#selforder
```

Jika self order dideploy sebagai subdomain:

```text
https://order.domain-kamu.com/?1
```

## Catatan Maintenance

Source utama tetap berada di root project. Jika ada perubahan fitur, lakukan perubahan di source utama dulu, lalu refresh isi folder `deploy-ready`.

## Pembayaran langsung pickup dan delivery

Paket ini sudah memuat checkout bayar di outlet, penerimaan kasir, dan delivery
di mana kurir membayar produk ke outlet serta menerima ongkir langsung dari
pelanggan. Untuk delivery tunai yang sudah ditugaskan, driver menekan
**Proses Pesanan** untuk meneruskan ke dapur tanpa penerimaan kasir; pencatatan
pelunasan tetap terpisah. Card POS memakai nama pemesan dengan chip Delivery,
Takeaway-Rumah, atau Takeaway Outlet. QR outlet membawa `origin=outlet` saat
masuk ke jalur pickup `/pesan/`. Sebelum rollout, pasang migrasi
`20261112053635_customer_cash_at_outlet.sql` dan pembaruan Edge Function
`create-duitku-payment` dari source project. Upload folder ini saja tidak memasang
aturan database, notifikasi server, atau koreksi laporan ongkir tersebut.
Status pemasangan dan langkah lengkap ada pada `docs/customer-pay-at-outlet.md`
di source project. Muat ulang aplikasi driver dan POS setelah frontend diperbarui.

Detail driver menyediakan berbagi lokasi, nomor pelanggan, serta ringkasan
pesanan melalui pemilih aplikasi perangkat. Jika pemilih tidak tersedia, dialog
menawarkan WhatsApp dan salin teks. Konfirmasi WhatsApp memisahkan patokan dan
tautan lokasi ke baris tersendiri tanpa mengulang alamat/pin.

Laporan delivery tunai memakai total produk tanpa ongkir dan menggabungkan
salinan lokal/server berdasarkan identitas pesanan, sehingga perubahan nominal
tidak menghasilkan transaksi ganda. Rincian pendapatan delivery diambil ulang
dari pesanan saat memuat laporan, termasuk riwayat di perangkat baru. Ringkasan
periode memakai rincian yang sudah dikoreksi jika rentang datanya lengkap.
Pratinjau struk POS memakai kertas krem bergerigi dengan seluruh informasi,
navigasi, menu cetak, dan unduh gambar tetap tersedia.

Card pesanan selesai juga memuat item, variasi, catatan pelanggan, dan harga;
detail native dibaca otomatis jika belum tersedia secara lokal. Driver hanya
mendapat tombol pengambilan setelah dapur siap, disertai keterangan pesanan
selesai disiapkan. Gerbang pelanggan/SO menjalankan animasi secara default;
parameter `motion=off` menghentikannya bila diperlukan.

Kunjungan baru tanpa kelanjutan checkout memakai keranjang kosong. Refresh,
Back, perpindahan layanan, dan kelanjutan pesanan mempertahankan keranjang aktif.
Header rekomendasi memakai pita biru bersama dengan keterangan kecil di semua
jalur masuk. Jam pengambilan pickup memiliki card khusus; pilihan Pilih jam
dan kolom waktu membuka pemilih waktu bawaan perangkat, dengan input biasa
sebagai fallback untuk browser yang tidak mendukung `showPicker()`.

Detail hasil SO/pickup memakai teks normal untuk referensi, waktu, serta nama
pelanggan; nominal dan chip nomor tetap ditonjolkan. Form pindah meja tetap dua
kolom pada layar kecil. Header card POS memakai chip layanan sebelum nama,
dengan status kasir di sampingnya. Untuk dine-in, chip nomor meja mendahului
nama; kode pesanan berada di baris metadata tanpa mengulang meja atau nama.
Jam pengambilan memakai gaya catatan biasa. Header checkout pickup menjadi
Ambil di Outlet dengan keterangan pengambilan sendiri; opsi segera tetap
disimpan sebagai Secepatnya agar kompatibel dengan pesanan sebelumnya.

Card dapur mengikuti susunan halaman Pesanan: chip layanan/meja dan nama di
judul, referensi pesanan serta transaksi kemarin di metadata, lalu jam
pengambilan biru dan catatan pelanggan terpisah. Catatan yang sama tidak
diulang; catatan batch tambahan tetap mengikuti itemnya. Checklist item dan
tombol tindakan dapur dipertahankan. Keterangan status pelanggan memenuhi lebar
card dan rata tengah.

Dapur menyediakan tab Batal; pesanan dibatalkan tampil dengan alasan tanpa
tombol proses. Pelanggan melihat ikon pembatalan bergaya ilustrasi dan kolom
keterangan terpusat; pickup selesai mengingatkan untuk mengambil ke outlet.
Driver menyatukan status pembatalan utama/delivery, menonaktifkan aksinya, dan
mempertahankan card batal milik driver pada tampilan aktif hari itu.

Notifikasi driver: menu titik tiga membuka Dering & notifikasi, dengan
bunyi, getaran, pilihan nada, tes dering, dan jeda ulang 15–120 detik. Browser
mendukung peringatan selama halaman berjalan. Jalur push native saat APK
tertutup disiapkan terpisah dalam kode Android, migrasi driver_push_devices,
dan cabang driver pada notify-new-order. Web ZIP ini sendiri tidak mengaktifkan
push: perubahan server perlu dipublikasikan dan APK driver baru dipasang.
Lihat docs/driver-native-notifications.md di workspace untuk aktivasi dan
batas pengujian. Semua masih lokal; layanan produksi belum diubah.

Keterangan Pesanan Siap Dijemput mengikuti kesiapan dapur, termasuk sebelum
pelunasan. Konfirmasi WhatsApp hanya tampil sebelum kurir memproses pesanan.
Progres pelanggan: Driver → Disiapkan → Menjemput → Diantar → Selesai.

Chip driver Batal mengelompokkan pesanan dibatalkan dan terlewat, dengan
keterangan berbeda pada masing-masing card. Rincian delivery pelanggan
memisahkan nominal pesanan dan ongkir tanpa mengubah total pembayaran.
Menu Pesanan/Dapur menampilkan badge merah untuk pesanan baru yang relevan.
Dapur memiliki kategori Pemberitahuan Takeaway untuk pickup rumah yang belum
diproses kasir: card ini hanya pengingat, tanpa item/checklist/tombol proses,
dan hilang setelah pesanan diproses kasir. Angka pada kategori tetap terlihat
ketika pengguna memilih filter dapur lain.
