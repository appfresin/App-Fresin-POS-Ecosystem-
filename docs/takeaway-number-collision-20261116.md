# Takeaway order number collision fix

Takeaway checkout previously selected the next T number from the current
device's local orders. Two fresh devices could therefore submit T001. While
the first order was unpaid, the normal order sync updated its existing row
with the second checkout's customer, items, creation time and kitchen status.
The POS and kitchen then merged that replacement by order number.

Checkout now reserves a unique T number through the existing server allocation
RPC before stock reservation. Network or invalid responses preserve the cart
and stop submission. Each new takeaway also stores a cryptographic creation
token. A fresh checkout without a matching token or server ID cannot update an
existing T order. Existing cashier updates retain the stored token.

The server migration adds the T sequence, seeded above existing T numbers, and
an immutable identity trigger protecting order number, creation time and
nonempty creation tokens. This also blocks older cached clients from replacing
a legacy T order. Valid preparation and payment updates remain supported.

Validation includes concurrent fresh-device numbering, failed allocation before
stock reservation, paid/unpaid collision protection, idempotent token retries,
item/addon/payment preservation, and all application copies. The installed
trigger was exercised against a temporary table with the transaction rolled
back. Three concurrent anonymous RPC calls returned distinct numbers without
creating orders or reserving stock. No customer transaction was modified.
