# Frontend Architecture

Current status: In Progress.

Milestone 4 builds a reusable frontend foundation after the approved Milestones 1-3 backend gates.
It must remain business-agnostic and consume backend contracts through authenticated APIs.

## Packages

- `apps/admin`: first web frontend shell for platform operations.
- `apps/mobile`: connected mobile app using the same frontend contracts and mobile experience
  standard for customer, driver, partner, and admin surfaces.
- `packages/frontend-core`: client-safe env parsing, Supabase client creation, API gateway client,
  runtime response validation, idempotency helpers, permissions, navigation filtering, onboarding
  state, and formatting helpers.
- `packages/mobile-design`: native-mobile design contract for color, interaction, onboarding,
  surface, and permission-aware navigation standards.
- `packages/ui`: reusable design primitives, application shell, state components, table/list
  surfaces, detail lists, dialogs, onboarding checklist, financial display primitives, and
  permission guards.

## Client Environment

The frontend exposes only client-safe Supabase values:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_API_GATEWAY_URL` when overriding the default Supabase Edge Function gateway URL
- `SUPABASE_URL` and `SUPABASE_ANON_KEY` are accepted as local-development fallbacks because they
  are also client-safe.

No service-role keys, database passwords, provider secrets, webhook secrets, Paystack secrets,
Gemini keys, map keys, or admin credentials may appear in frontend source or app env files.

## Authentication

The frontend uses the Supabase browser client from `@supabase/supabase-js`.

Session lifecycle behavior lives in `apps/admin/src/session.tsx`:

- initial session loading
- password sign-in
- sign-out
- token persistence and refresh through Supabase Auth
- authenticated session-context loading through `/runtime/session-context`
- structured error states

The backend remains the authority for role and permission data.

## API Access

All frontend API requests use `createApiGatewayClient` from `packages/frontend-core`.

The client provides:

- bearer token headers from the active Supabase session
- anon key header
- request IDs
- timeouts
- structured response parsing
- Zod runtime validation
- normalized gateway errors
- rate-limit and unauthorized error mapping
- client-generated idempotency keys for governed mutations

Visual components do not construct Edge Function URLs directly.

## Production Build

`apps/admin/vite.config.ts` splits React, data-access, and icon dependencies into separate chunks.
Production browser sourcemaps are disabled for the admin build so public artifacts do not expose
source maps by default.

## Visual Quality Standard

The frontend foundation must feel like an operating console, not a scaffold. Shared UI primitives
now provide grouped navigation, richer surface hierarchy, stronger metric tiles, mobile table-card
conversion, bottom navigation behavior, polished dialogs, and production-safe state panels.

These improvements live in the shared UI package so admin, partner, driver, customer, and future
module surfaces inherit the same quality bar.

## Routing And Navigation

Milestone 4 starts with lightweight hash routing to avoid adding business route assumptions before
the reusable shell stabilizes. Navigation definitions are filtered with backend-driven permissions
through `filterNavigationItems`.

The frontend may hide or disable inaccessible actions, but backend RLS and gateway authorization
remain mandatory.

## In-App Onboarding

The frontend foundation includes a reusable onboarding model:

- `OnboardingFlowDefinition`
- `OnboardingStepDefinition`
- `resolveOnboardingFlow`
- `OnboardingChecklist`

Onboarding is configuration-friendly and audience-scoped. It is not hardcoded to LPG, a specific
business, or a specific user type.

## Initial Workspaces

The admin shell includes generic backend workspaces:

- Overview
- Governance, including user profiles, account status controls, admin roles, admin users,
  business-line configuration, module activation, components, webhooks, and delivery queueing
- Applications, including an authenticated review queue for application assignment, correction
  requests, approval, rejection, and document review
- Organizations, including branches, staff roles, invitations, membership status, and ownership
  transfer
- Operations
- Finance, including deposits, withdrawals, escrow, settlement, commission, refund, and
  reconciliation controls
- Catalog, including units, categories, items, variants, prices, media, availability, stock, and
  orderability
- Integrations, including provider records, policies, communication, OTP, payment events, and
  webhook delivery visibility
- Onboarding

These are reusable platform domains. Business-specific screens remain blocked until the foundation
passes the Milestone 4 production gate.

## Admin Review Surface

`apps/admin/src/App.tsx` includes the first production-oriented admin operation surface for the
application and document lifecycle.

The surface consumes:

- `GET /runtime/application-types`
- `GET /runtime/applications`
- `GET /runtime/documents`
- `GET /runtime/documents/requirements`
- `POST /runtime/applications/reviewer`
- `POST /runtime/applications/corrections`
- `POST /runtime/applications/decisions`
- `POST /runtime/documents/review`

Every action uses the shared API gateway client with the active Supabase access token. The backend
continues to enforce workflow transitions, permissions, RLS, idempotency, and audit records.

The UI does not hardcode LPG, restaurant, driver, or vehicle behavior. It displays whatever
application types, statuses, document requirements, and records the backend returns.

## Governed Admin Console

`apps/admin/src/admin-resource-console.tsx` provides the reusable admin management surface for
resource lists and policy-backed actions. `apps/admin/src/admin-resource-config.ts` defines the
allowed admin areas, record lists, action labels, fields, permissions, and gateway endpoints.

The console covers:

- governance, admin access, business-line setup, module versions, components, webhooks
- account status changes backed by `public.set_profile_status`
- organization branches, roles, invitations, staff status, ownership transfer
- catalog records, prices, availability, stock, and orderability checks
- orders, assignments, workflow events, dispatch, tracking, verification, notifications, AI tasks
- deposits, withdrawals, transfers, escrow, refunds, settlements, commissions, reconciliation
- provider policies, communication messages, OTP challenge delivery and verification

The frontend adds client idempotency keys for mutations and validates form shape before submit. The
backend remains responsible for all policies, workflow transitions, RLS, financial movement, ledger
entries, audit logs, and provider execution.

Direct wallet top-up is intentionally not exposed as an arbitrary admin action. Funding must use a
governed payment/deposit path or another backend-approved financial procedure.

## Testing

Milestone 4 introduces frontend tests for:

- permission evaluation
- navigation filtering
- onboarding progression
- money formatting
- frontend idempotency key generation

Additional component, route, accessibility, and E2E tests are required before Milestone 4 can be
marked Complete.

## Mobile Direction

The mobile app follows `docs/30-mobile-experience-foundation.md`. It mirrors frontend-core contracts
for Supabase Auth, API gateway calls, permissions, onboarding, runtime validation, idempotency, and
money formatting while using mobile-first primitives for high-quality touch interaction.
`packages/mobile-design` defines the reusable mobile token, surface, onboarding, asset, and
navigation contract.

`apps/mobile/src/session.tsx` owns the connected session provider. It creates the client-safe
Supabase browser client, restores sessions, listens for auth changes, loads
`/runtime/session-context`, and exposes the shared API gateway client.

`apps/mobile/src/App.tsx` now renders real role-aware mobile workspaces from the authenticated API:
wallets, orders, service requests, assignments, drivers, vehicles, branches, catalog items,
applications, documents, messages, and business modules. These are reusable product surfaces, not
business-specific screens.

The same file also includes the first governed mobile Control Center. It can create service
requests, start applications, begin wallet funding, request and fetch in-app OTP codes, start
request tracking, and record verification checks through the API gateway with client-generated
idempotency keys. Full multi-step completion flows, QR camera integration, map rendering, uploads,
and mobile E2E coverage remain required before the mobile app can be marked production complete.
