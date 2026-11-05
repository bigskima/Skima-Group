# SKIMA Bills

Standalone customer Bills application for Android, iOS and web. It uses the current SKIMA Supabase project, Auth identity, API Gateway, utility-billing runtime, customer wallet/ledger and canonical Store checkout.

## Commands
- `npm install --prefix apps/bills-mobile`
- `npm run bills-mobile:check`
- `npm run bills-mobile:build`
- `npm run bills-mobile:android` / `npm run bills-mobile:ios`

## Configuration
Provide the shared `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` and `EXPO_PUBLIC_API_GATEWAY_URL`. Configure a dedicated EAS project with `EXPO_PUBLIC_BILLS_EAS_PROJECT_ID`. Native IDs default to `com.skima.bills` and may be changed before the first native store registration. Set `EXPO_PUBLIC_SKIMA_BILLS_BASE_URL` to the deployed web hostname; the domain is intentionally not hard-coded. Vercel serves the Expo SPA exported to `dist`.

## Shared runtime contracts
- Catalog, validation, payment and bill history: existing `/runtime/utility-billing/*` APIs.
- Shared customer wallets: `/runtime/wallets` and `/runtime/wallet-balances`.
- Funding and withdrawals: authenticated `finance-runtime`.
- Store: canonical catalogue and `/runtime/storefront/checkout`; no duplicate products, stock, orders or ledger.
