# Dine-in operating window

QR-table dine-in accepts new orders from ten minutes before the POS-configured
opening time until thirty minutes after its closing time, in Asia/Jakarta.
For an 11:10–22:30 schedule, ordering opens at 11:00 and closes at 23:00.
Takeaway, pickup, and delivery retain the original opening and closing times.

The gateway checks the selected service before entering the menu. Dine-in
submission rechecks the latest uploaded settings before stock reservation or
order submission, including when the menu was opened before the closing limit.
Existing-order status, cashier payment, and kitchen processing are unaffected.

Grace periods follow the scheduled operating day across midnight, including an
overnight closing, a late-night closing extending into a closed day, and an
early opening whose grace starts the previous day. Disabled days supply no new
window. Disabling operating-hour restrictions leaves all services unrestricted.

The closure dialog retains the POS schedule chip and shows the next permitted
dine-in opening when that service is selected. Settings explain the fixed grace
periods. No database migration is required.
