# Skima LPG

Skima LPG is the current Phase 1 launch product for LPG cylinder registration, refill ordering, station fulfilment, driver pickup/return, wallet-backed payment, tracking, verification, settlement, and commission workflows. It is built on reusable Skima platform engines, but the active customer, driver, station, and operations experiences are LPG-specific.

This repository is starting from a clean platform foundation. The governing source of truth is:

- [SKIMA_PLATFORM_CONSTITUTION.md](SKIMA_PLATFORM_CONSTITUTION.md)
- [Financial Policy Governance Directive](docs/32-financial-policy-governance-directive.md)
- [AGENTS.md](AGENTS.md)
- [to do.md](to%20do.md)

## Backend

The backend foundation uses Supabase:

- Supabase Auth for identity
- Supabase Postgres for platform data, policies, workflows, events, audit logs, and configuration
- Supabase Row Level Security from the first migration
- Supabase Edge Functions for health checks, authenticated APIs, runtime workers, and webhooks
- Supabase Storage buckets and metadata for governed platform documents and media

## Current Milestone

The backend-first remediation for Milestones 1-3 is approved. Milestone 4 now focuses on productionizing the dedicated Skima LPG launch application and LPG operations tooling, while keeping shared engines reusable underneath.

Milestone status is evidence-based:

- Milestone 1: Approved
- Milestone 2: Approved
- Milestone 3: Approved
- Milestone 4: In Progress

The reusable platform foundation remains in place, but LPG is no longer treated as a generic optional service in the launch UI. The current product surface is Skima LPG, backed by dedicated LPG runtime tables, routes, workflows, scans, station operations, driver jobs, settlements, and commissions.

The hosted Supabase gates now prove the Milestones 1-3 backend through no-frontend API/RPC flows:
business applications, document review, approval-to-activation, driver and vehicle onboarding,
driver-vehicle authorization, capability-based dispatch eligibility, organization staff management,
catalog/availability, order processing, NGN wallet deposits, Paystack-ready signed payment-webhook
processing, duplicate webhook protection, withdrawals, transfer success/failure reversal, escrow
funding, driver commission, business settlement, communication queueing, owner-only in-app OTP
delivery and verification, reconciliation, worker processing, append-only audit/ledger/event
records, and RLS/security negative checks.

Live real-money payment, SMS, WhatsApp, email, AI, and maps vendors remain swappable provider
adapter launch work. The hosted milestone gates use deterministic sandbox adapters so the platform
logic is testable without putting production secrets or money at risk.

See [Backend Domain Audit](docs/26-backend-domain-audit.md).

## Frontend

Milestone 4 introduces:

- `apps/lpg-mobile` for the dedicated Skima LPG launch mobile application
- `apps/admin` for the current Skima LPG operations web console until it is moved or aliased to `apps/skima-admin-web`
- `apps/mobile` as a reusable mobile foundation/reference shell only, not a second launch product
- `packages/frontend-core` for client-safe Supabase setup, gateway access, runtime validation,
  permissions, navigation, and onboarding logic
- `packages/mobile-design` for mobile design, media, role, and module visual contracts
- `packages/ui` for the reusable design system primitives

The admin operations surface should operate the LPG business: LPG customers, drivers, stations, applications, orders, scans, settlements, commissions, safety/disputes, and LPG configuration. Shared admin primitives may remain reusable, but launch-facing admin navigation should not promote unrelated businesses.

Company-adjustable financial policies are governed through the authorized backend policy layer,
with immutable versions, approval controls, audit history, and scoped effective dates. The admin
dashboard is the controlled management surface, not an alternative financial source of truth. See
the [Financial Policy Governance Directive](docs/32-financial-policy-governance-directive.md).

Frontend client env values must be Vite-prefixed:

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

After package installation succeeds, run:

```bash
npm run frontend:check
npm run frontend:test
npm run frontend:build
npm run mobile:check
npm run mobile:test
npm run mobile:build
```

The Phase 1 LPG mobile product is governed by the uploaded visual reference pack in
[apps/lpg-mobile/lpg-ui](apps/lpg-mobile/lpg-ui/README.md). Use that pack for the customer, driver, station, role
switching, onboarding, wallet, order, scan, settlement, inventory, and account screens before
approving mobile UI quality.

## Verification

Run:

```bash
npm run verify
```

## Remote Supabase Runtime

Only `SUPABASE_URL` and `SUPABASE_ANON_KEY` belong in app/client env files. Privileged deployment
values must come from the shell, a gitignored local operator env file, or CI secrets. Edge Function
runtime secrets must be stored with `supabase secrets set`.

The Deno deployment and verification scripts automatically load `.env` and `.env.local` when
present. These files are gitignored and are for operator gates only, not browser or mobile app
bundles. Shell values still take priority over local files.

```bash
supabase login
npm run supabase:link
npm run supabase:db:push
npm run supabase:functions:deploy
npm run supabase:remote:gate
npm run supabase:backend:e2e
npm run supabase:webhook:dead-letter
npm run supabase:applications:e2e
npm run supabase:drivers:e2e
npm run supabase:staff:e2e
npm run supabase:catalog:e2e
npm run supabase:orders:e2e
npm run supabase:finance-communication:e2e
npm run supabase:frontend-session:e2e
```

Docker is optional. Runtime validation uses a dedicated hosted Supabase development project through
`supabase db push` and `supabase functions deploy`.

See [Remote Supabase Dev Runbook](docs/runbooks/remote-supabase-dev.md). See
[Provider Credential Activation Runbook](docs/runbooks/provider-credential-activation.md) before
adding live payment, communication, AI, or maps secrets.

Required Edge Function secrets are stored in Supabase, not in app env files:

- `SKIMA_WORKER_SECRET`
- `SKIMA_PAYMENT_WEBHOOK_SECRET`
- `PAYSTACK_SECRET_KEY` and `PAYSTACK_PUBLIC_KEY` when enabling Paystack NGN deposits
- `SKIMA_OUTBOUND_WEBHOOK_SANDBOX_SECRET`
- sandbox provider secrets such as `SKIMA_SANDBOX_PAYMENT_SECRET`

## Authentication Foundation

App and admin clients authenticate through Supabase Auth with the client-safe helper in
`packages/auth`. Real Supabase Auth users are provisioned into `public.profiles` by the foundation
database trigger.

Admin access is not hardcoded. The platform has one service-role-bootstrapped super admin/general
manager and supports multiple role-based admins through `public.platform_admins`, `public.roles`,
and `public.user_roles`.
