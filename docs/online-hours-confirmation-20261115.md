# Online operating hours and pending-confirmation cards

## Behavior

- Kitchen confirmation notices use the same `orderNeedsCashierConfirmation`
  classification as the kitchen notification checkbox. Home pickup, QR-outlet
  pickup and SO takeaway remain visible as informational notices until accepted.
  They appear under Semua, Baru and Pemberitahuan Takeaway, without preparation
  controls or item details. Confirmed/cancelled orders leave the notice list.
- POS Settings → Self Order includes a daily online-ordering schedule. The switch
  is initially off; enable it and save the desired hours to apply a restriction.
  Every day has its own open/closed checkbox and opening/closing time. All times
  use Asia/Jakarta (WIB). An earlier closing time extends into the next day.
- Gateway pickup/delivery choices display a themed closure toast outside the
  schedule. Submission checks the settings again, so an already-open checkout
  cannot place a new order after closing. Table dine-in and existing-order status
  remain available. The toast includes today's schedule and the next opening.
- Settings persist in the existing `store_settings.self_order_settings` JSON
  under `onlineOperatingHours`. Public customer settings select this field
  explicitly, without adding staff or notification preferences to the public
  settings allowlist. Normal settings caching/realtime synchronization is reused.
- Drivers can cancel their own unpaid assignment before processing it, with a
  required customer-visible reason. Processing removes the action. The existing
  authenticated `driver_reject_order` RPC already enforces ownership, payment,
  cancellation and processing guards; no backend schema change is required.

## Verification

211 automated tests passed, including closing-time boundaries, overnight hours,
days off, schedule roundtrip, restricted-browser settings reads, blocked gateway
choices and submission, kitchen informational notices and driver cancellation.
An isolated browser fixture verified seven day rows, fourteen native time inputs
and no horizontal overflow at 360px and 402px. No live orders or notifications
were created during testing. This is a web update; no new APK is required.
