# Customer branding in fresh and restricted browsers

The customer's Instagram screenshot shows the initial Kasirin name/icon and a generic F in the hero. The server's canonical outlet row has the correct Fresin name and Google Drive profile image.

Two confirmed application paths explain this fallback remaining visible:
- Settings finishing after the gateway's first render did not request a gateway rerender (`shouldRenderAfterRealtimeLoad` excluded `gateway`). Existing browsers with cached settings could hide this problem.
- Master catalog reads supported direct REST without the external Supabase SDK; settings reads required that SDK. A blocked CDN therefore left the branding at its defaults. The exact network behavior on the customer's Instagram device was not captured.

Changes:
- Fresh customer pages show Fresin Indonesia and a first-party copy of the current circular logo immediately, without relying on a previously saved browser session.
- The existing profile image's Google Drive ID maps to the bundled logo. Other configured names/images remain configurable, with the bundled image available as a fallback.
- Settings updates can repaint the gateway, while the existing blocking-interaction guard still defers unsafe rerenders.
- If the SDK is unavailable, customer pages request an explicit customer-facing projection through the existing REST helper. This projection excludes staff settings and sync credentials. No grants, RLS policies, or server configuration changed.
- CDN script failures are caught so the REST fallback remains usable without an unhandled promise rejection.

Validation:
- Unit tests cover fresh defaults, configured branding, local logo mapping, deferred gateway updates, cached settings loads without the SDK, the public REST field allowlist, and handled script-load failures.
- The actual customer-settings projection was read successfully from the canonical server row.
- An isolated fresh Chrome profile loaded the real local customer entry with every remote request intercepted. The SDK CDN was blocked; mocked REST settings changed the header to a distinct QA name/outlet, both local logos loaded, the gateway retained two choices, and no runtime exceptions occurred. No real orders, authentication, or production mutations were sent.
- This simulates a fresh/restricted browser; it is not a direct test on the customer's Instagram installation.
