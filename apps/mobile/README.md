# Mobile Foundation Reference

This app is not the Skima LPG launch product. It is a reusable mobile foundation/reference shell that signs in with Supabase Auth, loads the authenticated session context, and reads live platform data through the shared API gateway client.

The intended launch mobile application is `apps/lpg-mobile`. Do not expand this reference shell into a competing generic customer product or a generic service marketplace.

Any reusable mobile foundation code kept here must use:

- Supabase Auth with only client-safe Supabase URL and anon key values
- `packages/frontend-core` for session context, API gateway access, permissions, validation,
  idempotency, onboarding, and money formatting
- light, dark, and system appearance modes backed by shared Skima design tokens
- reusable mobile primitives for buttons, inputs, sheets, lists, cards, status, wallet, maps, QR,
  notifications, loading, empty, offline, and error states
- configurable business-module visual identities resolved from backend module metadata and media
- backend media URLs for business logos, cover images, catalog images, driver avatars, vehicle
  images, document previews, QR payloads, and map previews
- currency display preferences from the backend Currency Engine; the app only shows enabled
  currencies

No LPG-only, restaurant-only, driver-only, or partner-only foundation components belong here. LPG
product composition belongs in the Phase 1 module experience file and must compose reusable mobile
primitives.

## Connected Runtime

The current mobile slice connects to:

- `/runtime/session-context`
- `/modules`
- `/lpg/locations`
- `/lpg/cylinders`
- `/lpg/cylinders/history`
- `/lpg/quotes`
- `/lpg/orders`
- `/lpg/orders/active`
- `/lpg/scans`
- `/lpg/driver-locations`
- `/runtime/wallet-balances`
- `/runtime/orders`
- `/runtime/service-requests`
- `/runtime/orders/assignments`
- `/runtime/drivers`
- `/runtime/vehicles`
- `/runtime/organization-branches`
- `/runtime/catalog/items`
- `/runtime/applications`
- `/runtime/documents`
- `/runtime/communications/messages`
- `/runtime/application-types`
- `/engines/currencies`
- `/engines/verification-definitions`
- `/runtime/payments/deposits`
- `/runtime/otp/challenges`
- `/runtime/otp/delivery`
- `/runtime/tracking/sessions`
- `/runtime/verifications`

The mobile Control Center currently supports governed actions for:

- registering LPG cylinders
- saving customer LPG pickup/delivery addresses
- creating LPG refill quotes through the bounded LPG API
- starting a reusable application
- beginning wallet funding
- requesting and fetching an in-app OTP code
- starting request tracking
- recording a verification check
- switching between light, dark, and system interface modes
- selecting a display currency from currencies enabled by the backend

The dedicated LPG launch app uses this role-specific navigation contract:

- customer: Home, Cylinders, Orders, Wallet, Account
- driver: Home, Jobs, Scan, Earnings, Account
- station: Dashboard, Jobs, Scan, Settlements, Account
- admin: Overview, Orders, Drivers, Finance, Admin

Only client-safe Supabase values may be exposed to the app:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- optional `VITE_API_GATEWAY_URL`

See the LPG visual/product reference pack in `apps/lpg-mobile/lpg-ui/`.

Run the local mobile gates:

```bash
npm run mobile:check
npm run mobile:test
npm run mobile:validate
npm run mobile:build
```
