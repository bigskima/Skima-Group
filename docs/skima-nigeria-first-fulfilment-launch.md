# Nigeria-First SKIMA LPG Launch — Implementation Plan

## Status

Working plan for branch `feat/skima-ng-launch-fulfilment-model-20261025`. This is not authorization to deploy, activate service areas, move funds, or launch unverified providers.

## Product decision

SKIMA will launch its customer platform in Nigeria first while LPG fulfilment expands by verified service area. National app availability must not be represented as nationwide LPG delivery coverage.

A customer supplies a delivery location and refill requirements. The backend determines which fulfilment paths can actually serve that request before the customer receives an actionable quote or can place an order.

## Supported fulfilment models

1. **SKIMA Managed** — SKIMA coordinates fulfilment using its approved managed network.
2. **Station Managed** — an approved station manages fulfilment through its own branch workflow and eligible station-owned delivery capacity.
3. **Independent delivery** — an approved independent delivery provider is assigned within the existing independent-driver workflow.

These are distinct operational paths. Do not conflate station-owned drivers with independent `driver_profiles`, and do not change the existing commercial `fulfillment_channel` merely to represent the operational fulfilment mode. Reuse existing fields and enums after verifying their meaning in the current schema.

## Station participation

An approved Station Managed station can serve both:
- customers it acquires directly and brings to SKIMA; and
- eligible customers/orders sourced by SKIMA and routed through the platform.

SKIMA-generated orders must be allocated by backend policy and eligibility, not by a client-side choice alone. Station visibility and assignment should consider branch status, product and stock eligibility, service coverage, operating capacity, delivery configuration, and provider readiness. Existing branch authorization, station-driver identity, settlement and audit controls remain authoritative.

## Customer journey and fail-closed rules

1. Resolve the customer's delivery location using the existing geography/serviceability engine.
2. Collect the LPG product/cylinder and requested quantity.
3. Query the backend for eligible fulfilment candidates and valid service modes.
4. Return only options that can fulfil the requested product and destination under current policy.
5. Generate the quote through the existing authoritative pricing/financial engine.
6. Create an order only after the backend revalidates eligibility and quote validity.
7. Snapshot the selected operational mode, provider/branch, price/fee breakdown, and policy versions as supported by the current schema.
8. Reuse the existing payment, reservation, dispatch, delivery verification, settlement, refund, and ledger lifecycle.

If no valid path exists, do not create a payable or confirmed refill order. Return a clear unavailable state and, where supported, offer an expansion-interest/service-area request. Do not claim an exact ETA or price without backend evidence.

## National platform scope

The app may be accessible throughout Nigeria. Individual services are enabled only where their provider, jurisdiction, operational and compliance requirements are satisfied.

- Account/profile and discovery can be nationally accessible.
- Bill payments are available only for supported billers/products and enabled payment rails.
- LPG delivery is available only where a valid fulfilment path exists.
- Provider onboarding and expansion interest do not imply immediate service availability.
- Service-area and provider activation must remain database/configuration-driven, not hardcoded to a list of cities.

## Station affiliate/referral programme

Introduce only after inspecting existing referral, campaign, commission and financial-policy infrastructure. Reuse universal platform capabilities; do not create a parallel wallet or commission ledger.

Desired policy capabilities:
- uniquely attribute an approved affiliate referral to a station organisation/branch;
- prevent self-referrals, duplicate attribution, and retroactive referral-code changes;
- define activation criteria for the referred station;
- configure eligible SKIMA fees, commission percentage, start/end time, payout threshold, reversals and fraud review through authorized backend policy;
- calculate earnings only from eligible SKIMA fees actually collected, net of applicable reversals/adjustments;
- preserve attribution and policy snapshots for audit;
- route payout and reconciliation through the existing financial engine and ledger.

Rates and durations are product/business policy decisions and must not be invented as production constants.

## Implementation sequence

### Phase 0 — Audit and baseline
- Inspect existing geography/serviceability, station eligibility, quote/order creation, fulfilment-mode snapshots, dispatch, Station Managed workflow, expansion-interest and financial-policy/referral systems.
- Record existing schema names, RPCs and API contracts before changing them.
- Add focused regression tests for existing fulfilment paths.

### Phase 1 — Unified fulfilment availability
- Establish one backend-authoritative response contract for eligible fulfilment options, using existing primitives wherever possible.
- Ensure the customer flow checks the delivery destination and requested product/quantity before exposing orderable options.
- Ensure the quote/order path revalidates eligibility server-side and fails closed when none is valid.
- Render a useful no-service state without disabling unrelated supported services.

### Phase 2 — Station Managed growth
- Verify station-owned-customer and SKIMA-generated-order flows both work end-to-end.
- Ensure station eligibility/dispatch policy, branch permissions, stock, delivery configuration and settlement rules are respected.
- Preserve the separation between station-managed drivers and independent/SKIMA-managed drivers.

### Phase 3 — Affiliate referrals
- Reuse the existing policy, commission, referral, audit and ledger systems if present.
- Add missing schema/API/UI only after schema and permissions review.
- Add idempotency, attribution integrity, reversals, reporting and authorization tests.

### Phase 4 — Verification and controlled release
- Run targeted unit/contract tests, migration checks on a disposable database, and build/type checks where available.
- Test each fulfilment mode, no-provider/no-stock/no-coverage cases, quote expiry, concurrent capacity changes, cancellations/refunds and authorization boundaries.
- Do not apply migrations to production, deploy functions, activate national coverage, or enable external provider delivery as part of branch development.

## Acceptance criteria

- A customer can request LPG from a destination and sees only backend-confirmed eligible options.
- No eligible station/provider/path means no payable/confirmed order is created.
- SKIMA Managed, Station Managed and Independent remain distinguishable and route to their correct existing workflows.
- A Station Managed station can serve both its own customers and eligible SKIMA-generated orders.
- One customer account, order/payment infrastructure, wallet, ledger and financial engine remain authoritative.
- Affiliate commissions are based on configurable eligible SKIMA fees and actual collection, not total station sales, and are auditable and time-limited.
- Service coverage and financial policy remain database-driven.
- No production deployment or live service activation occurs without separate verification and authorization.
