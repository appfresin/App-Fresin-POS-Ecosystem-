# Customer notes, delivery action and kitchen-ready alerts

Customer checkout stores only the customer's note in `orders.note`. Delivery landmarks, map links, coordinates and pickup time remain in their dedicated fields. Existing generated metadata is removed from POS notes, including batch notes, payment-form drafts and completed report cards. The driver's dispatch action is labelled “Antar pesanan”; payment and kitchen readiness checks are preserved.

Driver notification settings now have two independent sections:

- New orders retain their previous enable/sound/vibration/tone/duration/repeat settings.
- Kitchen completion has its own enable/sound/vibration/tone/duration and test action. Defaults: enabled, Chime, five seconds, one alert per order. It does not repeat when the cashier later records payment.

The original offer trigger and `DriverAlertService` reminder ledger remain separate from the new lane. The new database trigger queues `driver_ready` when kitchen preparation finishes and `driver_ready_clear` when the order leaves pickup readiness. Payment alone does not queue a ready event. Edge Function `notify-new-order` rereads the current order and sends the ready event only to the assigned, active driver's registered devices. Payloads contain order ID/number/status, without customer address or phone.

APK **1.11-driver**, version code 12, adds `DriverReadyAlertService` and a separate Android notification channel. It plays a bounded, one-shot sound while the app is in the background, persists deduplication, ignores stale events, and clears the ready notification when the order is dispatched or cancelled. Tapping the notification opens active tasks. A standard notification is used if Android refuses a foreground service. Notification permission, system sound settings and Android battery restrictions still apply.

Validation:

- 70 Node checks passed for notes, checkout/payment behavior, driver actions, offer reminders, independent preferences, owner-only ready dispatch and cancellation.
- Feedback browser verification passed at 310/348/402/430 pixels.
- SQL rollback-only test verified payment does not alert, kitchen completion alerts once, repeated payment does not duplicate, and dispatch clears. No synthetic order remains.
- Driver Gradle build, unit tests and lint passed.
- Existing offer repeat instrumentation passed; kitchen-ready instrumentation passed with the app in the background, independent settings, duplicate suppression and stale cancellation handling. An initial combined emulator run was interrupted during memory pressure; the focused ready test passed after reducing test-environment resource use.
- Physical-device FCM delivery remains a hardware verification step; emulator checks inject synthetic events locally and never send notifications to real drivers.

Backend migration: `supabase/migrations/20261114191648_driver_kitchen_ready_notifications.sql`.
APK: `APK/Anterin-Delivery-v1.11-debug.apk`. Install over Anterin 1.10; package and signing certificate are unchanged.
