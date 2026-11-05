# SKIMA Store

Standalone SKIMA customer commerce application for Android, iOS and web. It uses the existing SKIMA customer identity, shared customer wallet, canonical product catalogue, inventory availability, order runtime and checkout escrow. It does not create a second Store wallet, catalogue, inventory ledger or order system.

## App commands
- `npm install --prefix apps/store-mobile`
- `npm run store-mobile:check`
- `npm run store-mobile:build`
- `npm run store-mobile:android`
- `npm run store-mobile:ios`

## Configuration
Set the shared `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` and `EXPO_PUBLIC_API_GATEWAY_URL`. Set `EXPO_PUBLIC_STORE_EAS_PROJECT_ID` when the separate Store native project is registered. Android and iOS identifiers default to `com.skima.store`.

The production web hostname is configured later through `EXPO_PUBLIC_SKIMA_STORE_BASE_URL`; it is intentionally not hard-coded in the app. The planned custom hostname is `store.skima.online`. For Vercel, use `apps/store-mobile` as the project Root Directory, `npm run build:web` as the build command and `dist` as the output directory.

## Shared commerce contracts
- Identity: existing SKIMA Supabase Auth and shared customer profile.
- Catalogue: `/modules`, `/runtime/storefront/settings`, and `/runtime/catalog/*`.
- Checkout: `/runtime/storefront/checkout`, using the existing customer wallet and escrow.
- Orders: `/runtime/storefront/orders` and `/runtime/storefront/orders/confirm-receipt`.
- Wallet funding and withdrawals: existing `finance-runtime`; no Store balance or ledger.
- Product and order administration remains in the existing SKIMA Admin Store workspace.
- Existing Store foundation and delivery migrations are reused; this app adds no duplicate schema.
