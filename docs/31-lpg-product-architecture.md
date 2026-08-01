# LPG Product Architecture

Current status: Backend-first reset blocked.

The 2026-08-01 backend reset audit in `docs/32-lpg-backend-first-reset-audit.md` supersedes earlier
frontend-resume assumptions. LPG production frontend work may resume only after the full no-frontend
backend journey passes with backend-owned references, payment reservation, verification, tracking,
settlement, commission, reconciliation, notifications, and receipts.

Phase 1 launches Skima as a focused LPG refill product. Customers should not see unrelated service
categories. The launch experience is LPG-first, while the core platform remains reusable for future
business domains.

## Boundary

The LPG bounded context owns:

- customer LPG locations
- station branches and refill capacity
- cylinder registry and cylinder history
- LPG refill pricing
- refill quotes and refill orders
- cylinder scans
- station refill confirmation
- LPG driver locations
- LPG safety incidents
- LPG dispatch and driver acceptance

The LPG context reuses shared platform infrastructure for:

- Supabase Auth and profiles
- organizations and staff permissions
- wallets, ledger, escrow, deposits, withdrawals, settlement, and commission
- OTP, QR verification, notifications, audit, and provider execution logs
- driver profiles, vehicles, vehicle authorization, and capabilities
- map, payment, AI, storage, and communication provider adapters

## API Surface

The authenticated API gateway exposes `/lpg/*` routes for cylinder registration, saved addresses,
quotes, orders, dispatch, scans, refill confirmation, driver location, safety incidents, and
server-side Google Maps operations.

Map provider secrets stay in Supabase secrets. The frontend requests normalized location and route
data from Skima; it never calls Google Maps with a server key.

## Current Evidence

- LPG domain migration: `supabase/migrations/20260730120000_lpg_bounded_context.sql`
- LPG routes: `supabase/functions/api-gateway/index.ts`
- LPG mobile composition: `apps/mobile/src/phase-one-lpg.ts`
- LPG customer action forms: `apps/mobile/src/App.tsx`
- LPG UI reference pack: `docs/lpg-ui/`

## Remaining Gate Work

- remote migration push and function deployment for the LPG bounded context
- hosted gate coverage for cylinder registration, saved location, quote, order, dispatch, scan,
  refill confirmation, OTP delivery verification, settlement, commission, and reconciliation
- camera QR scanning and map rendering in the mobile app
- customer, driver, station, and admin LPG role screens must be rebuilt against the uploaded visual
  reference pack before production approval
