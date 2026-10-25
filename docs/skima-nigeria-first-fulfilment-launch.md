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
- configure eligible SKIMA revenue streams, commission percentage, earning window, reversals and fraud review through the authorized backend policy;
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


## Branch implementation record — 25 October 2026

The current feature branch now contains the first implementation slices below. These are code changes only; they have not been merged to `main`, and migrations or production services have not been activated.

- **Coverage and serviceability:** a new admin-controlled Station Managed external-coverage policy defaults off. The customer app checks Station Managed candidates separately, including a fallback when standard eligible stations cannot serve. The exception is restricted to `SERVICE_NOT_LAUNCHED`; an explicit exclusion, paused service, poor location accuracy, or policy conflict remains blocked.
- **Vehicle readiness:** Station Managed needs a branch driver and an approved, compliant, organisation-owned vehicle with current configured evidence and enough carrying capacity. Active vehicle assignment is reserved with the station delivery; quote eligibility and payment reservation fail closed if resources are absent. The station app and admin oversight workspace can assign/remove an existing registered vehicle without self-approving compliance.
- **Quote integrity:** Station delivery pricing is taken from the station’s backend settings. The quote trigger waits until the commercial policy snapshot is present, strips client-supplied pricing-lock metadata, and then preserves the derived price snapshot on subsequent updates.
- **Affiliate flow:** users can apply from Account settings and get an active referral code only after review. Station applications capture the code; backend submission validation prevents inactive codes, self-referrals and duplicate attribution. After the referred branch activates, commissions are calculated only from eligible revenue posted to the SKIMA platform revenue ledger and only during the configured earning window.
- **Financial governance and admin controls:** the existing SKIMA Fulfillment admin workspace includes a Station Affiliates section for immutable policy draft/submit/independent approval/activation, affiliate approval/suspension, referrals, earned commissions and posting exceptions. Commission percent and earning duration must be entered by an authorized admin; no default rate is activated by this migration.
- **Payout and reversals:** affiliates can withdraw posted commissions through the existing verified-beneficiary, fee-preview and withdrawal-policy workflow. Full LPG order refunds request a separate double-entry commission reversal; new withdrawals and approvals are held while a clawback recovery is unresolved. If the affiliate wallet cannot fund the reversal, the original earning is not falsely marked reversed; an exception is retained for authorized recovery/retry.

### Outstanding release gates

1. Run the Deno contract suite, TypeScript checks for the admin and LPG mobile apps, the repository migration-history verifier, and a disposable-database migration application/test. The contract suite has been extended, but these commands have **not** yet been run in a repository execution environment.
2. Inspect the generated database objects and trigger order after applying the migrations to a disposable database; this branch contains cross-migration trigger/function changes and should not be applied directly to production without that verification.
3. Review the draft pull request checks. Prior Vercel checks for this repository reported a build-rate-limit failure; a green application build has not been confirmed.
4. After approval and verification, deploy migrations under the normal release process. External Station Managed coverage remains disabled by default; affiliate accrual remains off until an authorized financial-policy version is created, independently approved and activated.

The branch does not claim national LPG delivery is available everywhere. It permits an order only when a backend-verified fulfilment path, station coverage, stock/pricing, required driver and compliant vehicle are available.
