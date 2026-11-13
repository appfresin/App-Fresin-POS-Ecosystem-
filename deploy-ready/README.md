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
pelanggan. Sebelum rollout, pasang migrasi
`20261112053635_customer_cash_at_outlet.sql` dan pembaruan Edge Function
`create-duitku-payment` dari source project. Upload folder ini saja tidak memasang
aturan database, notifikasi server, atau koreksi laporan ongkir tersebut.
Status pemasangan dan langkah lengkap ada pada `docs/customer-pay-at-outlet.md`
di source project. Muat ulang aplikasi driver dan POS setelah frontend diperbarui.
