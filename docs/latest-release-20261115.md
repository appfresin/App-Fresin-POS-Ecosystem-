# Latest local application release — 15 November 2026

Publishes the locally prepared application updates on top of GitHub commit
`450740b3d702f2f5642c7ccfd0565d6d7ca03935`. Preserves the eleven intervening
manual-upload commits and all existing documentation and backend files.

## Updated behavior

- Takeaway checkout collects and validates the customer's WhatsApp number.
- POS pickup cards show the number, a structured confirmation message before
  cashier acceptance, and a separate plain WhatsApp chat action.
- New orders persist the customer phone without overwriting an existing
  server order's phone during later synchronization.
- Driver rejection is restricted to unassigned, unpaid, unprocessed offers.
- Driver earnings no longer display saved bank-account settings or append
  account details to confirmation messages. Detail sharing is available through
  the order-summary action; customer chat opens without a prefilled message.
- New-order notifications retain sound, vibration and native/system delivery
  without a duplicate incoming-order banner. Kitchen-ready banners remain.
- Entry-page asset versions are updated across POS, SO, home ordering and driver.

## Validation

187 local automated tests passed across driver payment/processing, rejection,
cancellation notifications, takeaway, gateway, cashier confirmation, branding,
order numbers, routing, payment visibility and item preservation. The newly
included suites also resolve sources from `deploy-ready` for a deployment-only
checkout. No database migration or APK rebuild is included in this web release.
