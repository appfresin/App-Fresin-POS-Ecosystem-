# Kasirin Native FCM Push Notification Setup

Dokumen ini menjelaskan jalur native FCM untuk APK Kasirin WebView.

## Yang Sudah Disiapkan di Repo

- Android Firebase Messaging dependency dan service:
  - `APK/KasirinWebView/app/src/main/java/com/example/stockappseblak/KasirinFirebaseMessagingService.kt`
  - `APK/KasirinWebView/app/src/main/java/com/example/stockappseblak/KasirinFirebaseConfig.kt`
  - `APK/KasirinWebView/app/src/main/java/com/example/stockappseblak/KasirinOrderNotification.kt`
- Bridge WebView:
  - `window.KasirinAndroid.getFcmToken(callbackId)`
  - web mendaftarkan token ke Edge Function `register-device-token`
  - web tidak menjadi sumber utama pengiriman push, karena JavaScript tidak berjalan saat APK tertutup
- Supabase Edge Functions:
  - `supabase/functions/register-device-token`
  - `supabase/functions/notify-new-order`
- SQL migration:
  - `docs/fcm_push_notifications.sql`
  - trigger `trg_kasirin_notify_order_push` pada tabel `orders`

## Batasan Android yang Wajib Dipahami

FCM dapat membangunkan aplikasi saat background atau tertutup normal. Jika user melakukan Force Stop dari Android Settings, Android tidak mengirim event FCM ke aplikasi sampai aplikasi dibuka lagi. Ini batasan OS.

## 1. Buat Firebase Android App

1. Buka Firebase Console.
2. Buat project atau pakai project existing.
3. Add app Android dengan package id:

```text
com.kasirin.webview
```

4. Download file:

```text
google-services.json
```

5. Simpan file itu ke:

```text
APK/KasirinWebView/app/google-services.json
```

6. Jalankan importer otomatis:

```powershell
cd D:\Download\stitch_omnipos_integrated_system\APK\KasirinWebView
.\tools\import-firebase-config.ps1
```

Script akan mengisi nilai Firebase ke:

```text
APK/KasirinWebView/app/src/main/res/values/strings.xml
```

Hasil akhirnya berbentuk seperti ini:

```xml
<string name="kasirin_firebase_project_id">YOUR_PROJECT_ID</string>
<string name="kasirin_firebase_application_id">YOUR_ANDROID_APP_ID</string>
<string name="kasirin_firebase_api_key">YOUR_WEB_API_KEY</string>
<string name="kasirin_firebase_sender_id">YOUR_SENDER_ID</string>
```

Nilai ini bukan service account secret, tetapi tetap jangan taruh service role/Firebase private key di APK.
File `google-services.json` sudah masuk `.gitignore`.

## 2. Siapkan Service Account untuk Edge Function

Di Firebase Console atau Google Cloud:

1. Buat/download service account JSON yang punya permission mengirim FCM.
2. Simpan file sebagai:

```text
D:\Download\firebase-service-account.json
```

3. Jalankan script otomatis dari root project:

```powershell
cd D:\Download\stitch_omnipos_integrated_system
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\setup-fcm-supabase.ps1
```

Script ini akan:

- validasi isi service account JSON,
- set `FIREBASE_PROJECT_ID`,
- set `FIREBASE_SERVICE_ACCOUNT_JSON`,
- set `KASIRIN_PUSH_INTERNAL_SECRET`,
- simpan secret internal yang sama ke Supabase Vault,
- deploy `register-device-token`,
- deploy `notify-new-order` dengan `--no-verify-jwt`.

`notify-new-order` tetap aman walau gateway JWT dimatikan, karena function melakukan validasi sendiri:

- request dari browser harus punya Supabase user session valid,
- request dari database trigger harus membawa `x-kasirin-push-secret`.

Alternatif manual:

```powershell
supabase secrets set FIREBASE_SERVICE_ACCOUNT_JSON='<isi JSON service account satu baris>'
supabase secrets set FIREBASE_PROJECT_ID='your-project-id'
```

Supabase biasanya otomatis menyediakan:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

Pastikan ketiganya tersedia untuk Edge Functions.

## 3. Jalankan SQL Migration

Jalankan:

```text
docs/fcm_push_notifications.sql
```

di Supabase SQL Editor.

Tabel yang dibuat:

- `device_push_tokens`
- `push_notification_logs`

Client tidak diberi policy insert langsung. Token dan log ditulis lewat Edge Functions memakai service role.

Token dipisahkan dengan `scope_key`, yang dikirim web dari nama outlet/store. Ini mencegah notifikasi outlet lain ikut menerima push jika satu project Supabase dipakai untuk lebih dari satu outlet.

Migration juga membuat trigger order. Trigger ini memanggil `notify-new-order` langsung dari database saat:

- order aktif baru masuk (`new_order`),
- order aktif bertambah total/subtotal tanpa perubahan status/pembayaran (`additional_order`).

Dengan trigger ini, push tetap terkirim walau APK kasir/dapur sedang tertutup normal.

## 4. Deploy Edge Functions

Dari root project:

```powershell
supabase functions deploy register-device-token
supabase functions deploy notify-new-order --no-verify-jwt
```

Jika testing lokal:

```powershell
supabase functions serve register-device-token --env-file .env.local
supabase functions serve notify-new-order --env-file .env.local
```

## 5. Build APK

Dari:

```text
APK/KasirinWebView
```

jalankan:

```powershell
.\gradlew.bat :app:assembleDebug
```

Output debug:

```text
APK/KasirinWebView/app/build/outputs/apk/debug/app-debug.apk
```

## 6. Alur Runtime

1. User login Supabase di APK WebView.
2. Web memanggil `window.KasirinAndroid.getFcmToken(callbackId)`.
3. APK mengembalikan token FCM.
4. Web memanggil `register-device-token`.
5. Saat order baru/tambahan tersimpan di tabel `orders`, trigger database memanggil `notify-new-order`.
6. Edge Function mengirim FCM HTTP v1 ke device aktif.
7. APK menerima data message di `KasirinFirebaseMessagingService`.
8. APK menampilkan notification channel `Pesanan Baru`.

## Event yang Didukung

- `new_order`
- `additional_order`

Pesanan tambahan dari meja yang sama dikirim sebagai `additional_order`.
