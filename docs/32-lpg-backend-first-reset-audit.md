# LPG Backend-First Reset Audit

Date: 2026-08-01.

Status: Backend production gate blocked.

Progress update: `supabase/migrations/20260801010000_public_reference_engine.sql` adds a generic
public reference engine and initial namespace configuration for LPG and financial references. The
gateway now returns backend-owned `publicReference` values for the first LPG and finance create
paths. This does not unblock frontend production until the migration is applied and the complete
no-frontend LPG journey gate passes.

This audit supersedes any earlier conclusion that LPG frontend production work is unblocked. Milestone
1-3 shared platform evidence remains useful, but the LPG product is not production-ready until the
full backend-owned journey passes without frontend-generated references, sample data, direct vendor
coupling, or manual financial steps.

## Decision

Pause LPG frontend production work and stop adding screens to the large mobile application files.
The next implementation work must make the LPG workflow real, secure, testable, financially correct,
and backend-owned.

Do not build a disconnected LPG platform. Reuse the existing shared systems wherever they are valid:
authentication, profiles, organizations, permissions, wallets, ledger, payments, settlements,
notifications, OTP, communications, audit, storage, workflow runtime, event runtime, and provider
adapters.

LPG-specific code is allowed only inside the LPG bounded context or module configuration. Shared
platform engines must remain business-agnostic and provider-agnostic.

## 1. Current Backend Inventory

| Area | Current Evidence | Status |
| --- | --- | --- |
| Identity and profiles | Supabase Auth profile trigger, `profiles`, profile status runtime, admin profile status API. | Reusable shared system exists. |
| Authorization | `permissions`, `roles`, `role_permissions`, `user_roles`, platform admin role templates, branch-scoped organization roles. | Reusable shared system exists; LPG role coverage needs tightening. |
| Organizations and staff | `organizations`, memberships, branches, invitations, custom org roles, ownership transfer, staff status events. | Reusable shared system exists. |
| Applications and documents | Application type definitions, document requirements, application records, document submissions/reviews, activation functions. | Reusable shared system exists; LPG station and driver application definitions need production tuning. |
| Driver and vehicle engines | Driver profiles, vehicle types, vehicles, driver-vehicle links, capabilities, approval hydration from applications. | Reusable shared system exists; LPG eligibility needs more policy coverage. |
| Provider adapters | Adapter catalog for payment, maps, storage, notification, AI, queue, cache, observability; provider execution logs. | Reusable shared system exists; live certification incomplete. |
| Workflow and events | Workflow definitions, versions, states, transitions, workflow instances, event log, service request events. | Reusable shared system exists; LPG RPCs currently bypass some workflow semantics. |
| Pricing | Pricing policies and price quotes; LPG price table in `lpg_refill_pricing`. | Partial for LPG. |
| Financial engine | Double-entry ledger, wallet accounts, escrow holds, settlement executions, reconciliation. | Reusable shared system exists. |
| Public references | Generic `reference_namespaces`, `reference_sequences`, `public_references`, immutable subject references, and a public-reference runtime gate have been added. | Migration apply and hosted E2E evidence are still pending. |
| Payments | Deposit initialization, Paystack route, signed webhook processing, duplicate-webhook protection. | Partial for production; LPG order payment orchestration missing. |
| Withdrawals | Beneficiary validation, withdrawal request/approval/transfer success and failure reversal. | Reusable shared system exists. |
| Settlement and commission | Generic service request settlement, order business settlement statements, driver commission execution. | Reusable shared system exists; not yet wired end-to-end to LPG orders. |
| Communications and OTP | Communication messages, notification messages, in-app OTP challenge, protected OTP code fetch, OTP verification. | Reusable shared system exists; live SMS/email/WhatsApp disabled. |
| Verification | Generic `verification_definitions` and `verification_events`, `/runtime/verifications`. | Reusable shared system exists; LPG scan route currently bypasses it. |
| Dispatch and tracking | Dispatch policies, dispatch requests/candidates, tracking sessions/points. | Reusable shared system exists; LPG-specific orchestration is partial. |
| LPG module configuration | `business_modules` key `lpg`, workflow/policy/component records, capability bindings. | Configuration exists. |
| LPG bounded context | `lpg_customer_locations`, `lpg_station_branches`, `lpg_refill_pricing`, `lpg_cylinders`, history, quotes, orders, scans, refills, driver locations, safety incidents. | Runtime exists but incomplete for production. |
| LPG API routes | `/lpg/catalog`, locations, cylinders, quotes, orders, dispatch, accept-assignment, scans, refills, driver locations, safety incidents, maps. | Partial; missing production surfaces and generic adapter boundaries. |
| Workers | Runtime worker processes notifications, communications, AI, webhooks, jobs, escrow expiry. | Reusable worker exists; LPG-specific lifecycle workers missing. |
| Tests and gates | Backend, applications, drivers, staff, catalog, orders, finance/communication, webhook gates. | Shared gates exist; no full LPG journey gate. |

## 2. LPG Gap Analysis

| Requirement | Current State | Gap |
| --- | --- | --- |
| Customer LPG profiles | Uses shared `profiles`; no LPG customer profile/preferences table. | Add LPG customer profile/config where needed, without duplicating identity. |
| Customer locations | `lpg_customer_locations` exists. | Needs address autocomplete integration, freshness/verification rules, and negative permission tests. |
| Cylinder types and capacities | Cylinder records store size and capacity directly. | Add server-managed cylinder type/capacity config. Adding 15kg must be a data change, not frontend or function code. |
| Customer cylinders | `lpg_cylinders` exists and initial backend `CYL-...` references are configured. | `cylinder_identifier` remains a client-provided label; media, verification, and inspection flows remain incomplete. |
| Cylinder media | Asset IDs exist on cylinders. | Need upload/session APIs, media ownership validation, lifecycle, evidence metadata, and tests. |
| Cylinder verification and inspections | History/scans/safety incident records exist. | Need inspection records, status transitions, verification engine linkage, document/media evidence, and review workflow. |
| LPG pricing | LPG price table and module pricing policy exist. | Pricing keys, currency, amounts, and fees must resolve from config, not hardcoded in RPCs. Admin/manage API and tests are missing. |
| Refill quotes | Quote RPC exists and initial public quote/order references are configured. | Needs config-driven expiry, route/ETA cost support, and stale price handling. |
| LPG orders | `lpg_refill_orders` exists. | Not bridged cleanly to generic `order_records`; cannot complete payment, escrow, settlement, commission, and reconciliation end to end. |
| Station eligibility | Station branch table and nearest station selection exist. | Need station activation from applications, service zones/geofences, operating hours, capacity reservations, safety holds, and zone tests. |
| Driver eligibility | Dispatch checks approved driver, active vehicle link, capabilities, online status, and recent location. | Needs workload, vehicle capacity, service zones, document expiry, safety restrictions, manual override policy, and config-driven freshness window. |
| Dispatch | `dispatch_lpg_order` exists. | Requires `payment_reserved`, but no LPG payment reservation function sets it. Candidate rules are partly hardcoded. |
| Driver jobs and station jobs | Can be derived from `lpg_refill_orders`. | Need job views/APIs with role-specific fields and action permissions. |
| Cylinder pickup/station scans | `lpg_cylinder_scans` exists and initial scan-session references are configured. | Must route through `record_verification_event`; role-specific scan permissions and full QR/session flows are missing. |
| Refill records and actual kilograms | `lpg_refill_records` and actual kg update exist. | Needs over/under-fill policy, price adjustment/refund rules, inspection prerequisites, and settlement recalculation. |
| Tracking sessions | Generic tracking exists; LPG order has `tracking_session_id`. | Need automatic session creation, route updates, arrival/geofence detection, ETA refresh, and closeout. |
| Delivery verification | Delivery scan can mark delivered. | Need customer OTP/QR verification, verification event linkage, and driver commission trigger after delivery. |
| Station settlements | Generic settlement statements exist. | LPG station settlement after refill is not orchestrated from LPG status/workflow. |
| Driver commissions | Generic driver commission exists. | LPG commission is not automatically executed after delivery verification. |
| Refunds and disputes | Generic escrow refund/dispute statuses exist. | LPG-specific refund/dispute APIs, policies, evidence, notifications, and reconciliation gates are missing. |
| Safety incidents | `lpg_safety_incidents` exists. | Needs evidence media, escalation workflow, restrictions, alerts, and operational reporting. |
| Operational notifications | Generic queues exist. | LPG status changes do not consistently queue customer, driver, station, and finance notifications. |

## 3. Shared Systems That Remain

Keep these systems as shared platform systems:

- Auth, profiles, session context, platform admin governance.
- Organizations, branches, memberships, invitations, roles, and permissions.
- Applications, document requirements, document submissions, review and activation runtime.
- Driver, vehicle, driver-vehicle authorization, capability definitions, and entity capabilities.
- Assets, media assets, storage buckets, object policies, and provider-backed storage.
- Workflow definitions, workflow instances, event types, event log, and service request runtime.
- Pricing policies, price quotes, wallet accounts, double-entry ledger, escrow holds, settlement,
  commission, withdrawal, reconciliation, and audit logs.
- Provider adapters, provider execution logs, payment webhooks, notification messages,
  communication messages, OTP challenges, background jobs, webhooks, and runtime worker.

Do not move LPG-only assumptions into these systems. Extend shared systems only when the extension is
business-agnostic, such as a generic reference engine, generic workspace capability resolver, generic
provider adapter executor, or generic media upload session runtime.

## 4. Missing LPG Domains

Required LPG domains or domain records still missing:

- `lpg_customer_profiles`, if LPG needs reusable preferences, safety acknowledgements, or customer
  service constraints beyond shared profile data.
- Server-managed cylinder type and capacity records.
- Hosted E2E evidence for public reference generation across orders, cylinders, payments,
  settlements, withdrawals, commissions, scan sessions, and quote/order receipts.
- Cylinder media/evidence records tied to backend-managed assets.
- Cylinder inspection records with outcomes, evidence, expiry, and verifier identity.
- Station application/runtime binding that creates `lpg_station_branches` from approved
  applications and assigns the applicant as owner and initial station administrator.
- Station staff capability presets for owner, administrator, operations, finance, pump attendant,
  scanner/verification attendant, and viewer.
- Driver and station job read models.
- LPG payment reservation records or an order bridge that cleanly connects `lpg_refill_orders` to
  the financial engine.
- LPG dispute, refund, safety restriction, settlement hold, and recovery records.
- LPG tracking session policy records for route phases, location freshness, arrival, and geofence.

## 5. Missing APIs And Workers

Missing or incomplete API surfaces:

- `GET /lpg/config` for cylinder types, capacities, vehicle rules, application steps, pricing
  policies, commission policies, settlement policies, workflow definitions, status labels, and
  permission definitions.
- Remaining public reference response fields on operational job/read models not covered by the
  initial LPG and finance create/read wiring.
- Payment initiation and verification endpoint for an LPG order that reserves funds and updates
  `lpg_refill_orders.payment_status`.
- LPG order financial summary endpoint sourced from ledger/reconciliation, not calculated on the
  frontend.
- Station and driver job endpoints with capability-scoped actions.
- Scan-session creation endpoint that returns a backend-generated scan-session reference.
- Scan submission endpoint backed by the generic Verification Engine.
- Customer delivery OTP/QR challenge endpoint bound to an order and verification event.
- Refund, dispute, safety escalation, station settlement, driver commission, and receipt endpoints.
- Media upload session and evidence attachment endpoints for cylinders, stations, vehicles,
  applications, inspections, and incidents.
- Admin/manage endpoints for LPG pricing, cylinder types, status labels, station zones, and policies.

Missing workers:

- LPG order lifecycle worker for payment-reserved dispatch, timeouts, reassignment, and stale offers.
- Payment reconciliation worker that links deposit/webhook state to LPG order state.
- Station settlement and driver commission worker triggered by workflow/verification events.
- Refund/dispute/settlement-hold worker.
- Tracking freshness, geofence, arrival, and route refresh worker.
- Document/capability expiry worker for station/driver eligibility.
- Notification fanout worker for LPG operational events.
- Media quarantine/expiry worker for evidence and application documents.

## 6. Missing Provider Integrations

| Provider Area | Current State | Production Gap |
| --- | --- | --- |
| Payments | Paystack initialization and signed webhook exist; sandbox gates exist. | Account/webhook/payout certification, order payment orchestration, payout recovery, and reconciliation evidence are required. |
| Maps | Gateway calls Google Maps server-side and records provider logs. | Must execute through a provider adapter abstraction, add autocomplete, validate responses, rate/cost limits, fallback behavior, and geofence/arrival support. |
| Storage | Storage buckets/assets exist. | Need signed upload sessions, media processing/quarantine, object lifecycle, and evidence access tests. |
| Notifications | Sandbox communication active; live Resend/Twilio disabled. | Live email/SMS/WhatsApp provider credentials, templates, certification, retry/dead-letter, and opt-out policy are required. |
| OTP | In-app OTP exists. | Production delivery channel selection and channel-specific risk rules are required for customer delivery confirmation. |
| AI | Sandbox AI task runtime exists. | Live AI adapter certification, cost/rate controls, schema validation, and human/policy boundaries are required. |
| Observability | Health checks and provider logs exist. | Metrics, alerts, dashboards, financial exception alerts, and incident runbooks are required. |

## 7. Security And Permission Gaps

- Backend session context returns roles, permissions, memberships, and organizations, but not explicit
  authorized workspaces such as customer, driver, and station. Add a backend-owned workspace resolver.
- Frontend workspace changes must never grant permissions. Every API must enforce authorization
  independently.
- LPG station access is too broad in places. A station member should not automatically perform pump,
  scan, finance, staff, and administration actions.
- Scan actions need role-specific permissions. Customer pickup, station receipt, station release,
  inspection, and customer delivery are not the same capability.
- `record_lpg_cylinder_scan` currently accepts any actor who can access the order; it must enforce the
  correct actor for each scan type and route through verification definitions.
- `confirm_lpg_refill` checks organization membership/management, but pump attendant permissions must
  be capability-based and branch-scoped.
- LPG direct table grants rely on RLS and RPC guards. Production gates must verify direct insert/update
  denial for unauthorized users across LPG tables.
- Driver eligibility must include document validity, safety restrictions, workload, location freshness,
  vehicle capacity, and service zone policy.
- Station eligibility must include compliance expiry, safety holds, working hours, zone, stock/capacity,
  and branch-scoped role permission.
- Public references must not leak internal UUID patterns or provider references.

## 8. Payment And Reconciliation Gaps

- The frontend must not create or infer payment references. The backend needs separate concepts for
  internal IDs, public references, provider references, and idempotency keys.
- `lpg_refill_orders` are not yet financially complete. Generic finance functions use
  `order_records` and service requests, while LPG creates its own order table without a complete
  bridge.
- `create_lpg_refill_order` leaves orders awaiting payment. There is no LPG payment initiation,
  webhook-to-order state update, funds reservation, or automatic transition to `payment_reserved`.
- `dispatch_lpg_order` requires `payment_reserved`, so the customer journey stalls without manual or
  missing orchestration.
- Actual kilograms filled can change station amount, but there is no refund/adjustment policy when
  actual kg differs from quoted kg.
- Station settlement and driver commission runtimes exist generically, but no LPG workflow step
  executes them from refill/delivery verification.
- Reconciliation exists for service requests, but there is no full LPG reconciliation script proving
  deposit, reservation, station settlement, driver commission, refund/adjustment, and ledger balance.
- Withdrawal and payout recovery exist generically, but station/driver payout certification remains
  incomplete for production money.

## 9. Required Database Migrations

Implement in small migrations, keeping shared work business-agnostic:

1. Generic reference engine:
   `reference_namespaces`, `reference_sequences`, `public_references`, and
   `generate_public_reference(namespace, subject_type, subject_id, source, idempotency_key)`.
   Added in `20260801010000_public_reference_engine.sql`; pending database apply and hosted gate.
2. LPG reference columns or reference views for cylinders, quotes, orders, scan sessions, payment
   receipts, settlement statements, commissions, withdrawals, and receipts. Added in the public
   reference migration; pending database apply and hosted gate.
3. Server-managed LPG configuration tables for cylinder types/capacities, LPG status labels, station
   roles, scan policies, vehicle/capacity rules, and location freshness rules.
4. LPG station activation binding from approved applications to `lpg_station_branches`, including
   owner/admin role assignment.
5. LPG media/evidence tables and upload session metadata linked to shared assets/storage.
6. LPG inspection table and safety restriction workflow records.
7. LPG financial bridge to generic `order_records` or a generic finance subject interface that lets
   `lpg_refill_orders` participate in escrow, settlement, commission, refund, and reconciliation.
8. LPG payment reservation table or state records tied to deposits/webhooks and escrow holds.
9. LPG scan session table linked to `verification_events`, QR payloads, OTP challenges, locations,
   actors, and workflow events.
10. LPG job read models or secure views for customer, driver, and station work queues.
11. Tracking policy records for route phases, location freshness, ETA refresh, geofencing, and arrival.
12. Audit, notification fanout, dead-letter, recovery, and metrics records for the LPG lifecycle.

## 10. Implementation Sequence

1. Freeze prototype surfaces and remove frontend-generated business references from production paths.
2. Add the generic public reference engine and migrate LPG/public financial surfaces to use it.
   Initial backend migration and gateway wiring added; hosted E2E remains pending.
3. Add server-managed LPG configuration APIs for cylinder types, vehicle rules, policies, status labels,
   permissions, and application steps.
4. Connect station application approval to LPG station branch creation and station owner/admin roles.
5. Add station staff capability presets and branch-scoped permission gates.
6. Add LPG media upload/evidence and cylinder inspection runtime.
7. Bridge LPG orders to generic order/financial runtime, or generalize finance subjects in a
   business-agnostic way.
8. Implement LPG payment initiation, Paystack verification/webhook-to-order updates, funds reservation,
   and payment receipt references.
9. Replace LPG scan shortcuts with Verification Engine-backed scan sessions, OTP/QR delivery
   verification, and role-specific scan policies.
10. Implement dispatch after payment reservation with configurable station/driver eligibility, workload,
    location freshness, zones, and vehicle capacity.
11. Implement tracking sessions, ETA, route geometry, geofence, arrival detection, and location freshness.
12. Implement refill confirmation, actual-kg adjustment, station settlement, delivery verification,
    driver commission, refunds/disputes, reconciliation, receipts, and operational notifications.
13. Add workers for lifecycle automation, timeouts, retry, recovery, reconciliation, and notifications.
14. Certify live Paystack, maps, storage, communications, observability, and backup/restore operations.
15. Only then resume frontend production work against backend contracts.

## 11. Test Plan

Add a dedicated no-frontend LPG gate, for example `scripts/verify-lpg-lifecycle.ts`, covering:

- Customer registration, OTP verification, and backend session/workspace context.
- Address creation through map autocomplete/geocode/reverse-geocode with adapter logs.
- Cylinder registration with backend-generated `CYL-...` reference and media evidence.
- Cylinder inspection/verification and rejected unsafe cylinder paths.
- Quote creation using server-managed cylinder/pricing config.
- Order creation with backend-generated `SKM-...` reference.
- NGN Paystack/sandbox payment initiation, signed webhook verification, duplicate webhook protection,
  and funds reservation.
- Station assignment and driver assignment with negative eligibility cases.
- Driver acceptance, stale-offer timeout, and reassignment.
- Customer pickup scan, station scan, inspection, actual kg entry, station settlement, return tracking,
  customer OTP/QR delivery verification, driver commission, completion, and receipt notifications.
- Actual kg lower/higher than quote with refund/adjustment policy.
- Dispute, refund, safety incident, failed payout, and recovery paths.
- Ledger reconciliation after every financial branch.
- Unauthorized customer, driver, station staff, pump attendant, finance manager, viewer, outsider, and
  platform admin negative tests.
- Direct table mutation denial for LPG runtime tables.
- Idempotency replay tests for every create/action endpoint.
- Provider failure, retry, dead-letter, and alert evidence.
- Performance smoke tests for dispatch, active orders, station jobs, driver jobs, and location writes.

Keep existing shared gates:

- `npm run supabase:remote:gate`
- `npm run supabase:applications:e2e`
- `npm run supabase:drivers:e2e`
- `npm run supabase:staff:e2e`
- `npm run supabase:catalog:e2e`
- `npm run supabase:orders:e2e`
- `npm run supabase:finance-communication:e2e`
- `npm run supabase:webhook:dead-letter`

The new LPG gate must prove the integrated product journey, not only isolated shared engines.

## 12. Production-Readiness Checklist

- [ ] No frontend-generated business references remain in production paths.
- [ ] Backend generates and returns all public order, cylinder, payment, settlement, withdrawal,
  commission, and scan-session references.
- [x] Initial generic reference engine stores internal IDs, public references, provider references,
  and idempotency keys as separate concepts.
- [ ] LPG configuration is server-managed for cylinder types, capacities, vehicle rules, policies,
  workflows, status labels, application steps, and permissions.
- [ ] LPG uses shared platform engines without hardcoding business logic into platform engines.
- [ ] Every LPG order is financially connected to wallet, ledger, escrow, settlement, commission,
  refund, and reconciliation runtime.
- [ ] Paystack account, webhook, and payout paths are certified before real customer money is enabled.
- [ ] Maps run through a replaceable provider adapter with autocomplete, geocode, reverse geocode,
  route, ETA, traffic where available, geofence, and arrival evidence.
- [ ] Operational media uses backend-managed storage, signed upload/session rules, RLS, audit, and
  lifecycle policies.
- [ ] Station owner/admin/staff roles are capability-based and branch-scoped.
- [ ] Drivers remain independent Skima delivery partners, never station-owned by default.
- [ ] Backend session context returns only authorized workspaces and capabilities.
- [ ] Every LPG API has runtime validation, authorization, idempotency, audit, observability, and
  negative tests.
- [ ] Workers cover payment reconciliation, dispatch, timeout, tracking, settlement, commission,
  refund/dispute, notification, and recovery.
- [ ] Metrics, alerts, runbooks, backups/PITR, and incident response are documented and tested.
- [ ] Full no-frontend LPG journey gate passes on hosted Supabase.

## Frontend Gate

Frontend production work may resume only after this backend journey passes end to end:

```text
Customer registration
-> OTP verification
-> Address creation
-> Cylinder registration
-> Cylinder reference creation
-> Refill quote
-> NGN payment
-> Payment verification
-> Funds reservation
-> Station assignment
-> Driver assignment
-> Driver acceptance
-> Customer pickup
-> Cylinder scan
-> Station arrival
-> Station scan
-> Safety inspection
-> Actual kilogram entry
-> Station settlement
-> Return tracking
-> Customer OTP or QR verification
-> Driver commission
-> Order completion
-> Ledger reconciliation
-> Notifications and receipts
```

Until that gate passes, LPG mobile screens and admin screens are reference material only. They must
not provide fallback references, prices, statuses, ETAs, stations, drivers, balances, or images.
