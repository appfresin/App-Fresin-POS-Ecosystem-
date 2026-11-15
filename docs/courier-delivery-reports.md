# Laporan delivery tunai

Kasus D001 memperlihatkan satu pesanan tersimpan dengan produk Rp5.000 dan
ongkir Rp10.000. View laporan lama mengembalikan `total=15000`, sedangkan
perhitungan POS memakai pendapatan produk `5000`. Penggabungan lama memakai
nominal sebagai bagian kunci, sehingga keduanya menjadi dua baris laporan.

`reportMergeKey` menggabungkan salinan lokal/server tanpa menjadikan nominal
sebagai identitas. Penanda struk dan penghapusan yang sudah tersimpan tetap
memakai `reportRecordKey`. Data impor dipisahkan dari pesanan asli.

Pemuatan laporan membaca `payment_provider`, `grand_total`, dan `delivery_fee`
untuk pesanan delivery dalam kelompok maksimal 100 ID. Provider `courier_cash`
memakai pendapatan `max(0, grand_total - delivery_fee)`. Total dari view yang
sudah dikoreksi tidak dikurangi lagi. Delivery online serta data impor
mempertahankan perhitungan yang sudah ada. Jika rincian tidak dapat diverifikasi,
hasil yang belum terverifikasi tidak dipasang sebagai cache laporan baru.

Rentang laporan yang selesai dimuat dicatat dalam `supabaseReportCoverage`.
Ringkasan dashboard dan periode memakai rincian lengkap yang sudah dikoreksi,
sehingga view ringkasan lama tidak mengembalikan ongkir sebagai pendapatan.
Riwayat yang baru dimuat sebagian tetap memakai ringkasan lengkap yang tersedia.

Pemeriksaan D001 hanya memakai GET dan navigasi tampilan. Tidak ada pesanan,
pembayaran, grand total pelanggan, atau ongkir yang diubah di server. Perbaikan
frontend tersimpan lokal dan di `deploy-ready`; view server belum diubah.

Verifikasi baca-saja:

```powershell
node tools/verify-courier-report.mjs D001
node --test tests/report-courier-revenue.test.js
```

Pratinjau struk mempertahankan logo, usaha/outlet, nomor, waktu dibuat/dibayar,
jenis pesanan, pelanggan, metode pembayaran, item/modifier, subtotal, diskon,
total, Cash/QRIS, serta navigasi dan menu. Tepian SVG berada di dalam ukuran
kertas agar ikut tercakup oleh ekspor gambar.

Card selesai pada halaman Pesanan merender item, variasi, catatan, dan harga.
Data lokal lengkap atau cache detail dipakai kembali, termasuk pesanan yang
dibuat pada hari sebelumnya tetapi dibayar pada rentang laporan saat ini.
Detail native yang belum tersedia dibaca otomatis dengan maksimal empat
permintaan sekaligus. Kegagalan dapat dicoba ulang lewat tombol muat rincian.
Data impor tanpa item tetap menampilkan ringkasan; card ini tidak menyediakan
aksi pengubahan atau pelunasan pesanan.
