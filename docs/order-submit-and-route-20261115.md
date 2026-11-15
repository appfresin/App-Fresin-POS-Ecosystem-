# Order routing and customer delivery submission

Changes:
- Driver completion returns to the active Order list and clears the selected detail, instead of opening earnings.
- Report transaction details label the existing delete action **Hapus Transaksi**.
- Bare `/order/` opens the outlet takeaway gateway (pickup and delivery). Explicit table QR URLs still open dine-in; explicit mode parameters retain their existing meaning.
- Home pickup and delivery allocate short P/D numbers using an atomic server sequence before committing stock. New devices no longer derive D001 from an empty local order cache.
- New customer orders cannot update a different customer's existing record just because the order numbers match. Paid-order safeguards remain in place.

Diagnosis:
The live database already contained a completed, paid D001. The former per-device allocator could generate D001 again, and the sync helper looked up that number as though it were the same transaction. It returned `ORDER_ALREADY_PAID`, while checkout displayed a generic connection error. This failure path was reproduced in the sync regression test; the original failed browser request was not captured.

Database:
- Migration `20261115045113_customer_order_number_allocation.sql` adds two sequences and `allocate_customer_order_number(text)`.
- The function uses security invoker with an empty search path and accepts only D/P. Customer roles have sequence usage, not update/reset privileges. No order-table access grants change.
- Initial sequence values are seeded beyond existing numeric D/P order references. Gaps are expected when a checkout is retried or abandoned.

Validation:
- Customer number, checkout, route, order preservation, report, driver extension and takeaway regression suites pass.
- SQL rollback test as `anon`: 12 distinct delivery allocations, pickup formatting, rejected invalid prefix, and no sequence-reset privilege. Applied RPC separately verified as `anon`.
- Local browser `/order/` visibly shows exactly two service choices, pickup and delivery.
- No customer orders, payments, or driver alerts were created for testing. Allocation checks consume sequence values only.

These changes are web assets and a database RPC; no new APK is required.
