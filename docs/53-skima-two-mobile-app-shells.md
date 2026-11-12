# SKIMA two mobile shells and four complete web products

**Status:** Implementation contract for the consolidated customer mobile release  
**Date:** 2026-11-12

## 1. Product decision

SKIMA distributes two customer mobile applications through Google Play:

- **SKIMA Refill** — the existing Refill/LPG mobile shell, Android identity `com.skima.lpg`, Expo slug `skima-lpg`.
- **SKIMA Logistics** — the existing Logistics mobile shell, Android identity `com.skima.logistics`, Expo slug `skima-logistics`.

This is a mobile distribution consolidation. It is not a consolidation or retirement of SKIMA's four web products.

## 2. Mobile workspaces

The Refill mobile shell contains two full customer workspaces:

- Refill: the complete LPG, fuel and energy fulfilment experience.
- Bills: the complete Bills customer application, including bill discovery, validation, payment, activity, receipts, saved billers, wallet, notifications, account and support.

The Logistics mobile shell contains two full customer workspaces:

- Logistics: the complete customer, provider, company and driver logistics experience.
- Store: the complete Store customer application, including the product catalogue, product detail, basket, checkout, orders, wallet, notifications, account, referrals, support and permitted Store management screens.

Store and Bills are not reduced to small cards or partial pages. Their existing complete app workspaces and their dedicated navigation are hosted inside their assigned shell. Each module has a clear return action to its parent workspace. The host shell supplies the authenticated session and shared query client; module-specific policy gates, guides, navigation and notification registration remain scoped to the module.

## 3. Four complete independent web products remain

All four web products remain full, independently deployable and directly accessible:

| Product | Source application | Production web address |
|---|---|---|
| Refill | `apps/lpg-mobile` | `https://refill.skima.online/` |
| Logistics | `apps/logistics-mobile` | `https://logistics.skima.online/` |
| Bills | `apps/bills-mobile` | `https://bills.skima.online/` |
| Store | `apps/store-mobile` | `https://store.skima.online/` |

Each source application retains its own Expo web configuration, web build script, Vercel project configuration and product routes. The integrated mobile workspaces must not be used as a reason to remove, redirect, simplify or disable any of the four web products.

In particular:
- Refill's web build remains the full Refill web application.
- Logistics' web build remains the full Logistics web application.
- Bills' web build remains the full Bills web application.
- Store's web build remains the full Store web application.

## 4. Public website and discovery

The public website at `https://skima.online/` presents two mobile download destinations: Refill and Logistics.

The website must continue to expose four service destinations, each linking to its own full web product. Bills and Store are described as full web experiences, not as discontinued services. Service discovery records for all four products remain intact; the two-app filter applies only to the mobile-download cards.

## 5. Administration and backend boundaries

The Admin application remains a separate application and retains distinct workflows for:

- Refill, LPG and fuel operations.
- Bills providers, products, bill-payment controls and transaction operations.
- Logistics companies, drivers, bookings, verification and settlement operations.
- Store products, sellers, inventory, orders and marketplace management.

The mobile shell consolidation does not merge product permissions, application identities, data ownership, ledger entries, settlement policies, provider configuration, notification categories or audit trails. Existing backend services, API routes, database tables, RLS policies and financial controls remain in place.

## 6. Routing, identity and safety

- The host app's authenticated session is injected into the hosted module; the module does not create a second independent sign-in session.
- Store and Bills keep their own module-specific navigation and policy acceptance flows.
- Notification payloads retain the canonical `app` scope and `route.path`; host notification handlers first open the assigned module, then the module validates the route against its own route allowlist.
- Returning from Store or Bills must preserve the parent app's previous navigation history.
- Protected records must still be fetched and authorized through the existing backend after navigation.
- Do not change existing Android package names, iOS bundle identifiers, Expo slugs, Supabase project references or ledger identities as part of this consolidation.

## 7. Release boundary

Only Refill and Logistics are the planned customer mobile store releases. Bills and Store remain maintained as web products and as reusable full customer workspaces hosted by their assigned mobile shell. The four web deployments must be tested independently of the two mobile builds.

Do not trigger new Google Play submissions or production deployments merely by merging this architecture change. Build, signing, store listing and production release readiness must be validated separately.
