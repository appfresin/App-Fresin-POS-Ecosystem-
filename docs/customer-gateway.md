# Gerbang pelanggan Fresin App

Desain Signature diterapkan pada 11 November 2026: header dari fungsi aplikasi
yang sudah ada, kartu hero biru gelap berjudul **Fresin App** dengan kata App
berwarna krem. Judul memakai Nunito Black yang dibundel lokal (lisensi SIL OFL
di `Customer Gateway/fonts/OFL-Nunito.txt`). SO meja memakai font dan tiga baris
sapaan/judul/keterangan yang sama dengan halaman utama. Sapaan **Selamat Datang di** diperbesar;
Keterangan **Aplikasi pemesanan Fresin Indonesia** berada di bawah judul dalam satu baris,
tanpa titik dekoratif pada sapaan. Bintang utama ditempatkan dekat sudut kanan
atas. Tagline **Lebih mudah, lebih cepat** memakai sans-serif yang diperbesar dan
dipertebal, satu baris tanpa kotak di bagian bawah hero. Kata lebih cepat
beraksen krem dengan garis tipis. Frasa Lebih mudah melayang ke atas sementara
lebih cepat bergerak ke bawah; judul Fresin App bergerak ringan dengan ritme
berbeda. Bintang bergerak dan berkilau perlahan. Sesuai permintaan agar halaman
utama tetap bergerak, semua entry pelanggan dan SO memakai `data-motion="on"`
secara default, termasuk browser yang melaporkan reduced motion. Parameter
`motion=off` mematikan animasi secara eksplisit pada semua preferensi perangkat.
Kelompok sapaan/judul/keterangan diberi ruang atas tambahan. Cahaya lembut
di balik bawah logo berdenyut perlahan dengan pilihan animasi yang sama.
Pola lingkaran halus dipusatkan pada logo profil Fresin yang diperbesar dan
sengaja terpotong di tepi hero. Kartu pickup berwarna biru muda, kartu delivery
berwarna krem, dengan bayangan yang lebih dalam.
Pilihan antar pada halaman utama berjudul **Diantar (Delivery)**. Satu helper
`serviceArt` dipakai di halaman utama dan SO: kantong berganti toko untuk pickup,
truk berganti kantong untuk delivery, dengan slide dan gerak halus bersiklus
8 detik. Ukuran pickup dan delivery sama dalam setiap layout; `motion=off`
menampilkan ikon pertama secara statis.

Gerbang menyesuaikan tinggi viewport tanpa scroll halaman. Satu kartu berlatar
biru yang lebih tegas dengan sentuhan krem membungkus judul pilihan layanan
dan kedua tombol berwarna. Judul ditonjolkan dengan bidang biru muda dan teks biru
tebal sebagai header yang menyatu dengan kartu. Khusus SO meja, judul pertanyaan
dihapus: Makan di sini memakai permukaan krem-biru, ikon biru dan CTA biru
selebar kartu. Penanda meja memakai medali ikon, latar krem dan kode meja dalam
bidang biru tersendiri. Judul Kamu bisa juga berada di tengah dengan garis tipis
di kedua sisi, mengantar dua card pengenalan biru pastel dan krem: Pesan dari
rumah serta Diantar (Delivery), dengan ikon, panah dan keterangan
lengkap. Baris Dari Fresin, untuk hari baikmu dihapus; footer memuat Pesanan saya.
Ikon opsi tambahan diperbesar menjadi 46px (40px di HP kecil, 32px landscape).
Keterangannya diringkas menjadi “Ambil ke Outlet saat pesanan selesai” serta
“Pesanan diantar ke rumahmu, (dikenakan ongkir)”. CTA Lihat menu memiliki denyut
bayangan, kilauan dan gerak panah berkala dengan siklus 5,6 detik, aktif secara
default dan dapat dihentikan memakai `motion=off`.
Alat makan bergerak berlawanan arah lalu kembali bersilang. Kode meja di dalam
bidang ikon yang sama tetap diam. Badge meja di header menu SO dihapus karena
kode meja sudah berada di baris layanan. Baris layanan memakai biru untuk
pickup/dine-in dan krem untuk delivery. Semua jalur pelanggan (SO meja,
Take Away outlet, pickup rumah, delivery) memakai komponen chip kategori yang
sama, dengan foto produk aktif melalui helper thumbnail/fallback yang sudah
ada. Foto tetap 44px tanpa bingkai dalam; chip luar dirapatkan. Non-Kopi memilih
foto minuman cokelat/taro/matcha jika tersedia, dan Semua memakai tumpukan foto minuman dan donat dari produk aktif. Ilustrasi SVG hanya menjadi fallback jika foto belum tersedia.
Filter, urutan produk, dan handler kategori lama tetap digunakan. Integrasi
thumbnail memakai satu bridge ringan pada kelima salinan core aplikasi.
Jarak dirapatkan di layar kecil. Ikon Store/Truck memakai
Lucide dengan lisensi di `Customer Gateway/LICENSE.lucide.txt`. Halaman pesanan
kosong memakai kartu biru pastel, ilustrasi keranjang berlapis dan tombol Jelajahi menu yang mempertahankan
isi keranjang. Tombol support membuka hanya kartu kontak di bawah gerbang,
tanpa bingkai luar atau tombol tutup. Halaman awal tetap tanpa scroll;
membuka support menambah area gulir untuk mencapai kartu tersebut. Bingkai
logo foto usaha di header gerbang dibuat bulat.

## Jalur masuk

| Jalur | Perilaku |
| --- | --- |
| `/pesan/` | Pintu masuk pelanggan utama: pilih Ambil di toko atau Diantar, lalu menu |
| `/self-order/?mode=takeaway` | Gerbang sama; Ambil di toko meneruskan Take Away outlet yang sudah ada |
| `/delivery/` | Gerbang sama; memakai alur customer-home yang sudah ada |
| QR meja Dine In | Halaman SO: Makan di sini / Lihat menu dominan, Pesan dari rumah dan Diantar (Delivery) sebagai pengenalan |
| `/delivery/status/...`, `/order/status/...` | Langsung melanjutkan pelacakan, melewati gerbang |
| Tautan kembali pembayaran | Melanjutkan proses yang ada; tidak mengubah layanan atau pembayaran |

Root domain produksi `/` diarahkan ke `/pesan/` oleh `vercel.json` dan fallback
`deploy-ready/index.html`. Aplikasi kasir tersedia di `/pos/`; URL bawaan arsip
APK kasir v1.4 adalah `https://fresinapp.vercel.app/pos`, sehingga jalurnya tetap
terpisah dari root pelanggan. APK tidak perlu dibangun ulang untuk perubahan UI.

## Integrasi

- `Customer Gateway/customer-gateway.js` dipasang setelah ekstensi Take Away dan,
  bila ada, Customer Order. CSS memakai prefix khusus agar halaman lain tidak berubah.
- Header merender fungsi yang sudah ada, dengan nama usaha, outlet, dan foto
  profil dari settings aplikasi. Label meja/mode disembunyikan pada gerbang
  karena layanan belum dipilih. Tombol support memakai bagian kontak yang sama.
- Keenam entry pelanggan menandai startup sebelum script inti dimuat. `render()`
  menunda render pelanggan sampai ekstensi selesai menentukan gerbang, checkout,
  atau pelacakan. Gateway melepas pengaman dan merender secara sinkron, sehingga
  menu lama tidak sempat tampil. POS tidak ditahan oleh pengaman ini.
- Tombol **Ubah layanan** tersedia di menu setelah pelanggan memilih.
- QR meja dibaca melalui helper normalisasi yang sudah ada dan ditampilkan di
  hero. Makan di sini membuka menu asli serta mempertahankan nomor meja.
  Pilihan pickup dari QR outlet membuka `/pesan/?mode=pickup&origin=outlet`
  dengan metode PICKUP_PREORDER dan chip POS **Takeaway Outlet**. Entry langsung
  `/pesan/?mode=pickup` dari rumah mendapat chip **Takeaway-Rumah**;
  Diantar membuka `/pesan/` dengan metode DELIVERY. Tidak ada order yang dibuat
  ketika memilih layanan. Tombol pada entry Take Away outlet tetap memakai
  engine Take Away yang sudah ada.
- Sesi yang memakai gerbang meja menyimpan draft keranjang dan tiga field
  checkout/snapshot secara terpisah untuk tiap meja, Take Away, pickup rumah,
  dan delivery. Berganti layanan menyimpan draft lama dan memulihkan draft
  tujuan; kembali melalui browser juga memulihkan draft meja. Alur non-meja
  lama yang belum memakai pemisahan ini mempertahankan keranjangnya.
- Handoff hanya untuk origin yang sama, cocok pathname dan engine layanan, berlaku dua menit, dan
  dikonsumsi sekali. Pilihan disimpan dalam riwayat halaman, bukan setting toko.
- Tombol kembali, reload alur yang sudah dipilih, checkout lama, dan referensi
  status/pembayaran dipertahankan. State hasil pesanan dari rute lain tidak
  memaksa kunjungan baru ke `/pesan/` langsung membuka layar sukses lama.
- Shortcut pesanan memakai snapshot/ref milik sesi pelanggan melalui helper
  yang sudah ada; tidak menampilkan daftar pesanan seluruh toko.
- Shortcut pada gerbang meja memeriksa kecocokan nomor meja di snapshot sesi.
  Jika belum ada pesanan meja, aplikasi menampilkan pemberitahuan.
- Pada `/pesan/`, referensi enam pesanan terakhir disimpan di `localStorage`
  (`customer_home_active_orders`), bukan dicocokkan dari IP. Referensi bertahan
  setelah refresh/buka ulang pada browser dan origin yang sama selama data
  situs masih ada. Daftar saat ini hanya menampilkan pesanan aktif; pesanan
  selesai/dibatalkan disaring. Ini belum merupakan halaman riwayat lengkap.

Ini penyatuan gerbang/UI. Aturan pembayaran tidak diubah: Take Away outlet tetap
menggunakan alur diterima kasir/bayar nanti, sedangkan pickup dari rumah dan
Delivery mengikuti aturan Customer Order yang sudah berjalan. Tidak ada schema,
SQL, transaksi baru, atau perubahan jalur notifikasi pada fitur ini.

## Deployment dan verifikasi

Upload seluruh isi `deploy-ready` dengan struktur subfoldernya, termasuk
`pesan/`, `Customer Gateway/`, `delivery/`, `self-order/`, serta berkas root.
`pesan/index.html` memakai aset dari `delivery/` dan folder gateway; tidak cukup
mengunggah folder `pesan` saja. Perubahan belum otomatis dipublikasikan.

- 232 tes aplikasi lulus, termasuk 34 tes gerbang.
- Uji startup menunda modul gerbang selama 800 ms: yang terlihat hanya pemuatan,
  lalu gerbang sebagai render pertama. Pengujian inti juga mencakup bypass
  pembayaran/status, checkout aktif, QR meja, serta render POS.
- Uji browser Chrome terisolasi lulus pada viewport 320×568, 338×585, 375×641, 390×844,
  430×932, 768×600, dan 844×390 piksel: tidak ada scroll halaman atau overflow
  horizontal, kedua layanan dan footer terlihat, navigasi menu/back,
  perubahan layanan, keranjang, shortcut pesanan, dan kontak support berfungsi.
- Ketujuh ukuran tersebut juga diuji untuk gerbang meja: tiga tombol sesuai
  hierarki, konten tidak terpotong, kode QR meja tetap benar, menu asli dibuka,
  dan tombol kembali mengembalikan pilihan layanan. Draft meja dan layanan
  lain diuji terpisah, termasuk pemulihan setelah browser back.
- Browser menguji fixture lokal dengan kode/CSS gerbang yang sebenarnya serta
  header/data tiruan, tanpa login, pesanan, pembayaran atau database produksi.
  Screenshot fixture bukan screenshot sesi pelanggan produksi.
- Hasil pemeriksaan dan screenshot fixture ada di
  `tests/artifacts/customer-gateway/`.

Preview lokal: `http://127.0.0.1:8001/pesan/`.

Keranjang Customer Order tidak lagi menampilkan pemilih Take Away/Delivery.
Metode dari gerbang tetap digunakan; subtotal, rekomendasi, data checkout dan
jalur Checkout yang sudah ada dipertahankan.
