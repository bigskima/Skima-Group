# SKIMA Bills application

**Product:** SKIMA Bills  
**Native app identity:** `skima-bills`  
**Android package:** `com.skima.bills`  
**iOS bundle identifier:** `com.skima.bills`  
**Deep-link scheme:** `skima-bills://`  
**Backend:** existing SKIMA Supabase project

## Scope and integration

Bills is a dedicated customer application for Android, iOS and web. It shares the current SKIMA customer identity, Supabase project, API Gateway, wallet ledger, finance runtime and canonical Store catalogue. It does not create a Bills-only customer account, wallet, inventory or payment ledger.

- Authentication uses the same Supabase Auth account and session context as the other SKIMA customer apps.
- Service catalogue, account validation, payment requests, provider routing, pricing and bill history use the existing `/runtime/utility-billing/*` runtime. Admin configuration remains in the existing Utility Billing workspace.
- Funding and withdrawals use the existing `finance-runtime` endpoints. Top-ups open the finance provider's hosted checkout when returned; withdrawals use verified bank beneficiaries and the same wallet ledger.
- Saved billers are user-owned records in `utility_saved_beneficiaries`, protected by RLS.
- The Store experience reads the shared catalogue, variants, prices, availability and media, then posts checkout to `/runtime/storefront/checkout`. Orders and receipt confirmation use the existing Store order lifecycle.
- Notifications read and update the shared inbox via the existing notification-center RPCs.
- Refill and Logistics keep their existing customer workflows and receive dedicated Bills entry points. Refill's current embedded utility screen remains available.

## Environment configuration

Set the following in the app build/hosting environment:

| Variable | Purpose |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Existing shared Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Public anon key for that project |
| `EXPO_PUBLIC_API_GATEWAY_URL` | Existing shared API Gateway URL |
| `EXPO_PUBLIC_BILLS_EAS_PROJECT_ID` | Unique EAS project ID for Bills |
| `EXPO_PUBLIC_SKIMA_BILLS_BASE_URL` | Deployed Bills web hostname used for app fallback links |
| `EXPO_PUBLIC_SKIMA_STORE_BASE_URL` | Optional Store web handoff |
| `SKIMA_BILLS_ANDROID_PACKAGE` | Optional override before first Android store registration |
| `SKIMA_BILLS_IOS_BUNDLE_ID` | Optional override before first iOS store registration |

Native package/bundle defaults are set to `com.skima.bills`. Refill and Logistics native identifiers are not changed. The root domain is deliberately not chosen or hard-coded. Configure the Bills Vercel project against the monorepo root so its build can resolve the shared `packages/frontend-core` and Refill UI/theme source, then run:

```sh
npm --prefix apps/bills-mobile run build:web
```

The Expo web export is written to `apps/bills-mobile/dist`. Configure that as the Vercel output directory. The hostname belongs in the project environment, not the source.

## Build commands

```sh
npm run bills-mobile:check
npm run bills-mobile:build
npm run bills-mobile:contract
```

Android/iOS builds use the dedicated Bills EAS project. Do not submit builds until the EAS project ID and store metadata have been configured.

## Notification readiness

The Bills inbox uses the shared in-app notification center. The application requests device notification permission and handles validated Bills routes. This does **not** mean remote push is production-ready: push token registration/dispatch still depends on the shared product-scoped device-registration and push delivery infrastructure, plus Expo/Firebase/APNs credentials and physical-device testing. Missing credentials must never be represented as successful remote delivery.

## Operational release checklist

- Apply migration `20261104180000_skima_bills_saved_beneficiaries.sql` to the existing Supabase project.
- Configure the dedicated Bills EAS project and set `EXPO_PUBLIC_BILLS_EAS_PROJECT_ID`.
- Configure the final Bills hostname and hosting environment.
- Confirm required utility providers, bill products, provider routes and economics are active in the existing Admin Utility Billing workspace.
- Confirm Store module, storefront settings, eligible catalogue items, active prices, availability, fulfilment methods and locations are configured.
- Run the Bills type check, web export and contract test; resolve CI failures before merge.
- Test sign-in, registration/confirmation, password recovery, provider validation, payment reservation, provider success/failure/reversal, funding checkout, bank beneficiary verification, withdrawal, saved billers, Store checkout, delivery/pickup, receipt confirmation and inbox on device/browser.
