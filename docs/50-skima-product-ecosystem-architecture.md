# SKIMA Product Ecosystem Architecture

**Status:** Approved product direction; implementation is staged  
**Date:** 2026-11-04  
**Repository:** bigskima/Skima-Group  
**Backend boundary:** Continue using the existing shared SKIMA Supabase project. Do not create a Supabase project per product.

## 1. Purpose

SKIMA is a product family operated by one platform. It is not one oversized mobile application and it is not a collection of unrelated backends.

The product family has distinct customer and operator experiences while reusing the existing platform foundation: identity, profiles, organisations, permissions, PostgreSQL data, wallet and ledger, payment processing, notification inbox, media, audit, event/workflow runtime, and provider adapters.

The objective is to preserve the substantial work already present in the repository and extend it in controlled stages. This document is an architecture direction and acceptance contract; it does not assert that every listed product surface has already been extracted or released.

## 2. Product map

The intended public host pattern is expressed relative to a configurable root domain:

| Product | Intended host | Product boundary |
|---|---|---|
| Public SKIMA website | `https://<root-domain>` | Company information, product discovery, content, support, contact, partnerships and download links |
| SKIMA Admin | `https://admin.<root-domain>` | General administration web workspace; no separate customer-facing Admin mobile app is planned |
| SKIMA Refill | `https://refill.<root-domain>` | LPG and other supported energy products such as fuel, diesel and kerosene |
| SKIMA Store | `https://store.<root-domain>` | Standalone, complete Store shopping experience |
| SKIMA Logistics | `https://logistics.<root-domain>` | Logistics marketplace, service-provider workflows, bookings and fulfillment |
| SKIMA Bills | `https://bills.<root-domain>` | Standalone, complete utility and bill-payment experience |

The host names are logical roles, not purchased-domain claims. The actual root domain has not yet been selected or verified. Do not assume that `.online` is available, and do not commit `.online` as a required suffix. A purchased and controlled `.com`, `.online`, `.xyz`, `.org`, or other suitable domain must work without changing product identities or rewriting application logic.

The product family initially targets four customer mobile applications: Refill, Store, Logistics and Bills. The public website and Admin are web surfaces.

## 3. Product boundaries and cross-product access

### 3.1 Refill

Refill remains the energy-service application. LPG is the established product; supported fuel, diesel and kerosene services can be surfaced as additional service categories using the same product and fulfillment foundations where their business rules permit.

Do not create a separate application for every energy type unless a later business decision establishes a genuinely different product, operating model or regulatory boundary.

Refill retains a limited Bills entry point. It must not become a second full Bills application.

### 3.2 Store

Store has two experiences backed by one Store product domain:

1. **Standalone Store app:** full catalogue discovery, categories, product detail, basket, checkout, order tracking, customer order history and Store-specific support.
2. **Embedded Store sections:** curated Store discovery and useful shopping journeys within Refill, Logistics and Bills.

Embedded Store is not a copied catalogue, independent inventory, second basket database or separate checkout implementation. It consumes the same Store catalogue, price, stock, media, order and payment services. The embedded experience can be narrower than the standalone app and should offer a clear action to open the full Store app.

Where an embedded journey hands over to the Store app, preserve a safe product or category destination using the canonical URL/deep-link contract in [Application URLs and Deep Links](52-skima-domain-and-deep-link-contract.md).

### 3.3 Logistics

Logistics remains a distinct product for transport, delivery, service providers, bookings, dispatch and fulfillment. It includes:

- a limited Bills entry point and supported bill-payment journey for customers;
- curated Store discovery and shopping access;
- a clear way to open the corresponding standalone application for the full experience.

Do not merge Logistics business workflows into Refill or Store. Reuse shared platform services while keeping permissions, workspaces, order types, notifications and financial policies correctly scoped.

### 3.4 Bills

Bills is a complete standalone utility billing application. It must have its own navigation and focused experience for supported bill categories, billers/products, beneficiary management, payment review, status, receipts, transaction history, failed/ambiguous transaction recovery and support.

The LPG/Refill and Logistics apps retain limited Bills flows. The standalone Bills app owns the complete billing experience.

The existing utility billing architecture remains authoritative for provider adapters, provider routes, customer-wallet reservations, idempotency, ambiguous-vend recovery and reconciliation: [Utility Billing Architecture](utility-billing-architecture.md) and [Generic Utility Provider Contract](utility-provider-generic-contract.md).

No bill provider API credentials have been supplied yet. Until a provider route is configured, tested and approved, affected products must remain visibly unavailable. Do not fabricate catalogue responses, simulate successful vends in production, or move customer funds for an unavailable provider. The UI, provider-adapter contract, admin configuration and non-spending validation paths can be prepared before keys arrive.

### 3.5 Admin

Admin is a web-only general administration workspace at the configured Admin host. It governs platform-wide and product-specific configuration through permissions, policies, audit history and approved backend operations. Do not create an Admin Android/iOS app as part of this direction.

## 4. Shared platform and data boundary

All products continue to use the existing Supabase project and shared platform services. Do not create a new Supabase project for Store, Bills, Logistics or Refill.

Reuse, rather than clone:

- Supabase Auth and customer profiles;
- organisations, memberships, roles and permission checks;
- wallets, append-only ledger, payment records and settlement services;
- payment provider adapters and webhook processing;
- the existing notification inbox and event infrastructure;
- catalogue, media and storage services where applicable;
- audit, idempotency, background jobs and reconciliation.

One user identity may be used across the product family. A user's access to a product or operation remains permission- and policy-controlled. Shared authentication is not permission to share all data or notification content across products.

Business records must retain clear product/module and organisation scope. Each application's API requests must be authorized server-side; hiding a menu item is not authorization.

Financial data must have one authoritative ledger. An embedded Store or Bills experience must not create shadow balances, ledgers, escrow records or payment histories. Product-specific views may filter and present shared authoritative records.

## 5. Native application identities

Web domains and native app identities are independent.

A domain change must not require changing an Android package name, iOS bundle identifier, EAS project identity, account record or stored transaction.

Repository audit on 2026-11-04 found these existing native identities:

| Existing app | Android package | iOS bundle identifier | Existing scheme |
|---|---|---|---|
| Refill / LPG | `com.skima.lpg` | `com.skima.lpg` | `skima-lpg` |
| Logistics | `com.skima.logistics` | `com.skima.logistics` | `skima-logistics` |

Treat those existing IDs as established identities. Do not rename them merely to match a future domain. A package/bundle identifier is a long-lived store identity; changing it creates a new app identity and can break update continuity.

Store and Bills package names, bundle identifiers, URL schemes and EAS project IDs must be selected and reviewed before their first store registration/build release. Use distinct identifiers for each standalone product. Do not invent or silently register identifiers during unrelated work.

## 6. Domain-independent configuration

All public hosts must come from one centrally managed, validated configuration contract.

The deployment configuration should provide the equivalent of:

- `SKIMA_ROOT_DOMAIN`
- `SKIMA_PUBLIC_BASE_URL`
- `SKIMA_ADMIN_BASE_URL`
- `SKIMA_REFILL_BASE_URL`
- `SKIMA_STORE_BASE_URL`
- `SKIMA_LOGISTICS_BASE_URL`
- `SKIMA_BILLS_BASE_URL`

Client-safe build configuration may expose only the public base URLs needed by that application. Private secrets must never use public/mobile-prefixed environment variables.

Do not scatter literals such as `skima.online` through components, API handlers, email templates, notification payloads, QR codes or app configuration. Build canonical links through a shared URL resolver.

Changing the purchased domain should require configuration, DNS, TLS, redirect and website-association updates—not source-code rewrites. The detailed contract is in [Application URLs and Deep Links](52-skima-domain-and-deep-link-contract.md).

## 7. Cross-application navigation

Use verified HTTPS links as the canonical cross-product address. Each app should:

- understand its own supported routes;
- accept validated inbound product links;
- route an installed app to the correct screen;
- provide a web fallback when the app is not installed;
- show an appropriate App Store / Google Play installation CTA;
- preserve a safe destination through an installation handoff where a tested deferred-link mechanism exists.

Examples of canonical destinations are:

- `https://store.<root-domain>/products/<product-id>`
- `https://bills.<root-domain>/electricity`
- `https://logistics.<root-domain>/services/<service-id>`
- `https://refill.<root-domain>/orders/<order-id>`

Do not put authentication tokens, passwords, wallet secrets, private customer details or other bearer credentials in URLs or push payloads. Resolve sensitive data only after the destination app has authenticated the user.

Cross-app links are an enhancement, not a hard dependency for completing a primary task. If another app is missing, the current app must provide a usable fallback rather than a dead button.

## 8. Premium simplicity and interaction quality

The product family must look coherent and premium without making every product look identical.

Required quality bar:

- compact, purposeful balance and status summaries;
- no oversized cards used merely to fill screen space;
- short labels and helpful microcopy instead of repeated paragraphs;
- progressive disclosure for detailed records, receipts, explanations and advanced controls;
- lists and compact rows for repeated transactions, products, jobs and notifications;
- clear primary actions and predictable navigation;
- simple, progressive forms with sensible defaults and resumable state;
- consistent typography, spacing, radii, iconography and feedback;
- responsive layouts appropriate to phone, tablet and desktop;
- meaningful skeleton, empty, offline, error, retry and success states;
- accessible touch targets, focus states, readable contrast and reduced motion;
- real data and server-authoritative actions, never decorative or disconnected controls.

Preserve useful existing screens and workflows. Refactor only where required to achieve the agreed product boundary, quality bar, correctness or maintainability. Do not replace a working backend or duplicate a feature simply to make an app look independent.

## 9. Delivery strategy

All four customer applications remain in the product plan. Preparation and release happen in stages so completed work is retained and each product has a verified foundation.

Recommended order:

1. **Stabilize the shared foundation and current applications:** audit current `main`, active PRs, existing app identities, current builds, shared APIs and existing production migrations.
2. **Refine Refill and Logistics:** resolve outstanding defects and retain their current workflows; add the limited cross-product entry points without regressions.
3. **Complete standalone Store:** extract/compose its full experience from the current Store services while preserving the curated embedded Store sections.
4. **Extract standalone Bills:** reuse current utility billing architecture and existing LPG/Logistics entry points; activate provider routes only after real credentials and readiness tests exist.
5. **Complete public SKIMA website and domain cutover:** select and purchase a domain, configure hosts, HTTPS, app links, redirects and product download pages.
6. **Prepare Android and iOS releases:** validate each product's unique app identity, build profiles, signing, notification credentials, deep links, privacy declarations, store assets and device journeys.

Staging releases does not mean abandoning a product. It means each product is prepared, tested and deployable without requiring all four releases to happen on the same day.

## 10. Repository and change-control rules

- Start work from the latest verified `main`.
- Before branching or pushing, list open PRs and identify their product scope and changed files.
- Prefer the newest relevant non-conflicting PR branch only when it is current with `main` and its scope is appropriate.
- Do not attach work to a stale or unrelated branch merely to reduce PR count.
- Reconcile the feature branch when `main` advances; preserve both sides' changes.
- Do not merge unrelated feature work just because documentation was added to its branch.
- Review code, migrations, tests and security separately from documentation.
- Do not bypass failed required checks. Distinguish application failures from external account/quota failures and record the actual reason.
- Do not trigger unnecessary native builds or production migrations while credentials, quotas or approvals are unavailable.

## 11. Acceptance criteria

This architecture is being followed when:

- the public website, web Admin and four customer products have distinct product responsibilities;
- the four customer apps share existing SKIMA identity and platform infrastructure;
- Bills is a full product while Refill and Logistics retain limited bill-payment flows;
- Store is full as a standalone product and curated inside Refill, Logistics and Bills;
- one catalogue, inventory, order and wallet truth is maintained;
- changing the root domain does not require changing native app identity;
- app-to-app navigation has verified HTTPS links and a safe web/store fallback;
- every surface meets the compact, premium, functional design standard;
- existing working features and backend services are preserved unless a reviewed change is necessary.

## Related documents

- [Cross-platform push notification architecture](51-skima-cross-platform-push-notifications.md)
- [Application URLs, domain configuration and deep links](52-skima-domain-and-deep-link-contract.md)
- [Utility billing architecture](utility-billing-architecture.md)
- [Generic utility provider contract](utility-provider-generic-contract.md)
- [Design system](28-design-system.md)
- [Mobile experience foundation](30-mobile-experience-foundation.md)
