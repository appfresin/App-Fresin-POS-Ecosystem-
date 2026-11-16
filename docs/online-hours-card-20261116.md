# Closed-outlet notice — 16 November 2026

Replaces the ordinary closure toast with a centered native dialog and blurred
backdrop, matching the blue and cream gateway theme. Includes the outlet icon,
today's schedule chip, next opening time, and a thank-you footer. The dialog can
be dismissed using its close button or Escape and restores the previous focus.

The schedule and next opening use the daily hours uploaded by POS through
`store_settings.self_order_settings.onlineOperatingHours`. Submission requests a
fresh settings read instead of accepting the normal one-minute cache. The copy
uses "besok" before 05.01 WIB and "nanti" from 05.01 when today's opening is next,
as requested. Closed days and overnight operating windows remain supported.

Customer and POS entry pages receive updated asset versions. No database change,
notification change, or APK rebuild is included.

Validation: 96 related automated tests passed, alongside isolated browser checks
at 320, 390, 430, 844, and 1280 pixels, keyboard dismissal/focus, reduced motion,
and a read-only check of the uploaded POS schedule.
