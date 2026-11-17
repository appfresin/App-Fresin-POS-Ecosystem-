# Jarak dan ongkir delivery

Tarif yang disepakati pada 18 November 2026:

- Rute menggunakan profil `motorcycle`, optimasi `balanced`, dari koordinat outlet ke pin pelanggan.
- Jarak untuk hitungan dibulatkan ke 2 desimal kilometer (10 meter), dengan tarif Rp2.500/km.
- Bulatkan nominal ongkir ke Rp500 terdekat. Nilai tepat di tengah dibulatkan naik.
- Minimum ongkir Rp10.000.
- Tampilkan jarak Anterin dengan 1 angka desimal. Pembulatan tampilan tidak dipakai menghitung ongkir atau mengganti jarak asli yang tersimpan.

Rumus: `billableMeters = round(distanceMeters / 10) * 10`, lalu `max(10000, round((billableMeters * 2500 / 1000) / 500) * 500)`.

| Jarak asli | Untuk hitungan | Tampilan Anterin | Ongkir |
| --- | --- | --- | --- |
| 4.080 m | 4,08 km | 4,1 km | Rp10.000 |
| 4.100 m | 4,10 km | 4,1 km | Rp10.500 |
| 5.299 m | 5,30 km | 5,3 km | Rp13.500 |
| 5.300 m | 5,30 km | 5,3 km | Rp13.500 |
| 5.631 m | 5,63 km | 5,6 km | Rp14.000 |
| 6.123 m | 6,12 km | 6,1 km | Rp15.500 |
| 9.983 m | 9,98 km | 10,0 km | Rp25.000 |
| 11.093 m | 11,09 km | 11,1 km | Rp27.500 |

Order baru memakai hasil quote terbaru. Ongkir dan jarak order yang sudah tersimpan tidak dihitung ulang.

Verifikasi: `node --test tests/customer-delivery-route.test.js tests/customer-cash-payment.test.js` dan `node tools/test-location-map-browser.mjs`.
