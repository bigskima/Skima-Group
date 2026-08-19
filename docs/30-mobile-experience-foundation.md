# Mobile Experience Foundation

Current status: In Progress.

The first mobile slice is connected to Supabase Auth and the authenticated Skima API gateway. It
renders role-aware customer, driver, partner, admin, wallet, verification, update, LPG order, and
media surfaces from live platform records where the signed-in user has access.

The mobile experience must feel like a finished Skima product from the first screen. It must not be
a thin wrapper around backend records, and it must not duplicate the admin UI system.

Phase 1 is LPG-first. The platform architecture, APIs, engines, policies, and reusable UI primitives
remain business-agnostic, but the launch mobile product is composed around the LPG refill lifecycle.
LPG product copy, role navigation, and workflow presentation live in
`apps/mobile/src/phase-one-lpg.ts` and must not be copied into shared design contracts or backend
platform engines.

## Quality Bar

The mobile app must use a high-polish, role-aware interface built from reusable primitives:

- fast sign-in and session restoration through Supabase Auth
- secure in-app OTP display and verification where the backend permits it
- reusable onboarding flows for customers, drivers, partners, and admins
- dense but readable home surfaces for orders, wallets, tasks, applications, and alerts
- gesture-friendly action sheets, bottom sheets, segmented controls, and step flows
- strong empty, loading, offline, permission-denied, and error states
- production-safe payment, wallet, escrow, verification, tracking, and notification surfaces
- map views that consume normalized backend location data through provider adapters
- QR scanning views that call the reusable Verification Engine
- financial views that format any enabled currency, even though NGN is the phase-one currency
- light, dark, and system appearance modes using one reusable token system
- currency preferences that only list currencies enabled by the Currency Engine

## Design Direction

Mobile should feel energetic and premium without becoming decorative or business-specific.

Use:

- compact command surfaces instead of oversized marketing panels
- clear status color, motion, and iconography for live work
- bottom navigation for primary role areas
- bottom sheets for context actions and review decisions
- cards only for individual repeated items, tasks, transactions, documents, and orders
- stable touch targets, predictable spacing, and visible focus/pressed states
- role-aware dashboards assembled from backend-provided permissions and enabled modules

Avoid:

- LPG-only mobile components
- duplicate button, input, card, table, wallet, map, or QR systems
- visible internal engineering words
- hardcoded payment, AI, map, SMS, WhatsApp, or email providers
- assuming every user is a customer, driver, partner, or admin forever

## Shared Foundation

The mobile app should reuse the same contracts as the admin foundation:

- `packages/frontend-core` for client-safe Supabase config, gateway access, permissions, runtime
  response validation, idempotency, onboarding, and formatting
- `packages/mobile-design` for mobile color tokens, touch target standards, role-aware surface
  definitions, onboarding steps, and permission-filtered navigation
- shared design tokens mirrored into the native theme
- the same backend session context from `/runtime/session-context`
- the same workflow, event, finance, verification, tracking, and notification APIs

Native-only primitives may be created where needed, but their props and behaviors should match the
web foundation closely so future screens are composed consistently.

## Connected Mobile Slice

Implemented in `apps/mobile/src/App.tsx` and `apps/mobile/src/session.tsx`:

- Supabase password sign-in and sign-out
- session restoration with `onAuthStateChange`
- session context loading from `/runtime/session-context`
- role availability resolved from backend permissions and organization membership
- LPG-first role navigation for customer, driver, station, and admin modes
- shared gateway reads for LPG cylinders, LPG customer locations, LPG quotes, LPG orders, wallets,
  assignments, drivers, vehicles, branches, catalog items, applications, documents, messages, and
  business module records
- shared gateway reads for enabled currencies from `/engines/currencies`
- governed mobile actions for cylinder registration, customer address saving, LPG refill quote
  creation, application creation, wallet funding, in-app OTP request and delivery, tracking-session
  creation, and verification-event recording
- reusable loading, empty, error, wallet, service-line, media, QR/OTP, and role workspace surfaces
- client-safe environment usage only
- persisted light, dark, and system interface preferences
- persisted display-currency preference constrained by backend-enabled currencies

The foundation remains business-agnostic, while the Phase 1 product layer is LPG-first. Future
service modules must add their own product composition instead of changing shared primitives.

## First Mobile Surfaces

The first mobile implementation creates reusable foundations before business screens:

- authentication and account recovery
- in-app onboarding/tutorial flow
- role switcher/context selector with LPG-specific navigation labels, including customer
  `Home`, `Cylinders`, `Orders`, `Wallet`, and `Account`
- customer LPG cylinder registry, saved address, quote, order, escrow, tracking, and verification
  surfaces
- driver LPG assignment, route, pickup, station, delivery, verification, and earnings surfaces
- station refill queue, cylinder scan, kilogram entry, settlement, product, availability, and staff
  surfaces
- admin LPG operations, orders, drivers, stations, customers, finance, disputes, applications, and
  reports surfaces
- task/order list foundation
- wallet summary and transaction list foundation
- application/document submission foundation
- driver profile, fleet, vehicle, capability, availability, assignment, route, and earnings
  foundation
- partner/business profile, branch, staff, catalog, availability, order, media, and settlement
  foundation
- QR scanner foundation
- tracking map foundation
- notification inbox foundation
- support/AI assistant entry point through the AI orchestration layer

Future business modules will later configure their own labels, requirements, workflows, and actions.
They must not modify mobile platform primitives. Phase 1 does not present food, rides, courier,
pharmacy, marketplace, or generic service categories to customers.

## Remaining Mobile Work

Before mobile can be considered production complete, the foundation still needs:

- guarded write flows for onboarding, applications, documents, catalog operations, deposits,
  withdrawals, order actions, assignments, verification, and tracking
- full step-by-step completion flows after the initial governed action is created
- QR camera integration and secure OTP confirmation UX
- map provider rendering through normalized backend location responses
- richer component tests, route tests, responsive checks, and mobile E2E coverage
- production image/logo upload surfaces backed by the Media and Storage engines
- richer theme preview controls once brand/theme policies are exposed by the backend

## Business Modules And Media

The mobile foundation must render business modules through configuration and media records:

- module visual identity: module key, label, short label, category, tone, fallback icon, fallback
  initials
- business visual identity: logo URL, cover image URL, branch images, catalog media, and compliance
  previews
- driver visual identity: avatar, vehicle images, licence previews, ownership evidence, and
  capability badges
- verification visuals: QR payloads and scan result status
- location visuals: normalized map previews from map adapters

Actual uploaded images belong to the Media and Storage engines. The mobile app only renders
authorized URLs and safe fallbacks.

## LPG UI Reference Pack

The Phase 1 LPG mobile product is now governed by the uploaded visual reference pack in
`docs/lpg-ui/`. Those documents define the required customer, driver, station, role-switching, and
visual-quality bar for the launch UI.

Implementation must use the reference pack as the product standard:

- customer LPG journey: onboarding, cylinders, refill ordering, tracking, wallet, account, and
  partner application
- driver LPG journey: onboarding, vehicle approval, jobs, scan, delivery verification, earnings,
  and account
- station LPG journey: onboarding, jobs, scan, refill, settlements, inventory, staff, and settings
- role switching between customer, driver, station, and admin contexts only when backend
  permissions allow it
