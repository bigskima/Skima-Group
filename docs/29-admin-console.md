# Admin Console

Current status: In Progress.

The Milestone 4 admin console is a production-oriented operations frontend. It is not a
business-specific dashboard and it does not bypass backend policy.

## Production Scope

The admin console must support:

- admin sign-in, sign-out, session context, roles, permissions, and organization context
- admin role template management
- platform admin assignment and revocation
- user profile status changes for active, pending, and disabled accounts
- business-line/module configuration, versioning, component binding, and activation
- webhook endpoint configuration, delivery queueing, delivery history, and attempt visibility
- business, driver, vehicle, and document application review
- reviewer assignment, correction requests, approval, rejection, and document decisions
- organization branches, staff roles, invitations, memberships, status changes, and ownership
  transfer
- catalog units, categories, items, variants, prices, media, availability, stock, and orderability
- order creation, configured order actions, order assignment, order events, and acceptance policy
  visibility
- service requests, pricing, workflow start, event processing, participant assignment, and dispatch
- tracking sessions, tracking points, verification events, notifications, and AI task queueing
- wallets, balances, deposits, deposit verification, beneficiaries, withdrawals, approvals,
  transfers, escrow, refunds, settlements, commissions, and reconciliation
- provider adapter, currency, pricing, settlement, dispatch, verification, notification, and AI
  policy visibility
- communication message queueing, delivery sync, OTP challenge creation, in-app OTP delivery, and
  OTP verification

## Implementation

- `apps/admin/src/App.tsx`: shell, session-aware routing, overview, onboarding, and rich application
  review workflow.
- `apps/admin/src/admin-resource-console.tsx`: reusable record/action console for governed admin
  areas.
- `apps/admin/src/admin-resource-config.ts`: backend route catalog, action fields, permissions, and
  labels.
- `packages/frontend-core/src/index.ts`: Supabase client, API gateway client, runtime validation,
  permission helpers, formatting, and idempotency key helper.
- `packages/ui/src/index.tsx`: shared buttons, forms, dialogs, tables, state panels, badges, detail
  lists, and shell components.

## Policy Boundary

The frontend never performs direct table writes. Every admin action uses an authenticated gateway
route, and the backend remains responsible for:

- authorization
- disabled-account API blocking
- RLS
- workflow transitions
- idempotency
- audit logs
- ledger entries
- financial balancing
- provider execution
- webhook signing and delivery

Arbitrary wallet top-up is not exposed in the admin UI because the current backend supports governed
funding through deposit/payment flows and escrow refund/release paths. A future top-up or adjustment
button must first be backed by an approved financial policy and immutable ledger RPC.

Account disabling is exposed through `/admin/profiles/status` and `public.set_profile_status`.
Disabled profiles are rejected by the shared Edge Function auth guard before runtime APIs execute.

## Completion Evidence

- `npm run frontend:check`
- `npm run frontend:test`
- `npm run frontend:build`
- `npm run verify`

Reviewer approval is still required before Milestone 4 can be marked Approved.
