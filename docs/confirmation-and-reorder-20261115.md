# Kitchen confirmation alerts and restarting customer orders

## Behavior

- **Konfirmasi** is a device-specific checkbox alongside the kitchen category selections. It uses the existing native category bridge and token preferences, with an internal `__confirmation__` marker.
- A kitchen device receives a pending cashier confirmation only if that checkbox is selected. Product category selection applies after acceptance. With Konfirmasi alone selected, product-category alerts remain excluded; an empty selection retains all-product behavior and excludes kitchen confirmations.
- Cashier-target notifications retain their existing behavior. A delivery that is still searching for a driver, or awaiting driver processing, is not reclassified as an order requiring cashier approval. The direct driver-to-kitchen workflow is preserved.
- Confirmations are classified from the current database order by the Edge Function, not from client-supplied categories. Pending confirmations include opted-in kitchen devices even when the original event targets the cashier.
- The existing Android reminder RPC returns the confirmation marker while the order awaits acceptance, then its product categories after acceptance. This stops the confirmation reminder and preserves production reminders without an APK update.
- Web notification identities distinguish the confirmation and production phases so a kitchen alert is not lost after cashier acceptance.

**Pesan Lagi** now resets the selected service, checkout draft, and service draft caches, then displays the two-choice gateway. It clears stale `mode` parameters while preserving outlet origin. The existing active-order history is retained; the ordinary **Ubah layanan** behavior still preserves a draft.

## Deployment and validation

- Applied `cashier_confirmation_reminder_status` to Fresin and deployed `notify-new-order` version 7, ACTIVE. JWT configuration and internal authentication were preserved; deployed source matches all three local function files, including unchanged driver push logic.
- Live rollback tests cover pending pickup, acceptance, outlet takeaway, cancellation, and an unprocessed delivery. Synthetic orders and queued pushes were rolled back; no real device alerts were sent.
- Existing RPC permissions and two-field output are retained. Advisors still identify the pre-existing public SECURITY DEFINER status RPC; its anonymous UUID-based status lookup is intentional for the existing closed-APK reminder protocol. No access grants were added.
- Unit tests cover opt-in kitchen filtering, cashier compatibility, category-phase deduplication, server-side classification, and a fresh service choice after reordering.
- Isolated browser QA exercises the actual pickup, delivery, and takeaway reorder handlers and verifies two choices, no selected service, an empty cart, and cleared stale checkout data. The checkbox renders independently of product selection.
- No physical-phone background FCM delivery was triggered as a test.
