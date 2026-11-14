# Delivery location and driver rejection

GPS selection shows “Lokasi anda sudah dipilih” and hides the redundant confirmation button. Moving the pin restores “Tetapkan Lokasi”. Manual pin confirmation remains separate from GPS selection. Existing GPS selections with an accuracy value are recognized after updating.

The animated locate control sits at the bottom right, above the map attribution. Checkout rerenders retain the same MapLibre container/canvas, camera, and zoom. Leaving checkout releases the map. Failed interactive maps do not repeatedly retry during unrelated renders, and callbacks from retired maps cannot replace a newer map.

Drivers can reject an available courier-cash offer or their own assignment before kitchen release and payment. The dialog requires a reason of up to 500 characters and explains that rejection cancels the order for the customer. The server verifies a PIN-issued device capability, current staff access, ownership, expiry, payment and kitchen state under a row lock. It stores the reason in the existing `cancel_reason` field for the customer cancellation panel, and records the acting driver. There is no fallback to an unauthenticated direct update.

Validation:

- Node tests cover eligibility, reason validation, verified session requirements, RPC success and conflict handling.
- Isolated browser checks cover GPS success, pin changes, manual confirmation, twelve repeated renders, map cleanup and mobile widths 310/372/430.
- Existing feedback browser checks pass at 310/348/402/430, including the rejection dialog and escaped reasons preserved across rerenders.
- `tests/driver-reject-order.sql` passes as the anonymous API role using synthetic fixtures in a rolled-back transaction. No real orders were changed. It checks invalid capabilities, blank/oversized reasons, another driver's order, paid/released/expired orders, null status, duplicate rejection and persisted customer reasons.

Migration: `supabase/migrations/20261114183924_driver_reject_order.sql`.
