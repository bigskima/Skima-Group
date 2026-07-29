# Backend Domain Audit

Date: 2026-07-29.

Milestone 4 is paused until a reviewer approves this Milestones 1-3 backend evidence. This audit is
evidence-based: no row is marked `Approved` until the reviewer explicitly accepts it.

Allowed audit statuses:

- Complete
- Partial
- Configuration Only
- Missing Runtime
- Missing Security
- Missing Tests
- Missing Documentation
- Approved

## Passed Hosted Evidence

- `npm run supabase:remote:gate` passed against hosted Supabase with a real platform super admin.
- `npm run supabase:applications:e2e` passed with application
  `227a747e-e0c6-4a1b-bde6-5d6fff4948e3`, organization `a0a0552f-5393-4a54-9bff-2709f59163fa`, and
  partner `490b9529-458e-4a7b-a95d-384752d8aab1`.
- `npm run supabase:drivers:e2e` passed with driver application
  `40801c03-3f61-4f05-8f7a-66261b8e2824`, vehicle application
  `df973764-8562-4533-8d12-b0593643e890`, driver `7ba7b9dc-a1b1-4ca7-92fc-8bcaf6b148b4`, and vehicle
  `d6904601-dc97-4de2-81fb-5a0d61fe20d3`.
- `npm run supabase:staff:e2e` passed with organization `9a353ea3-9554-49b6-bae7-b8122347c552`,
  branch `f01ba9a9-2575-4469-9dba-4c875b482013`, staff user `a39157d8-2017-459e-83b6-5d6612f22e2d`,
  and invitation `138c4ec8-823c-4947-8c9e-051a97bf0a52`.
- `npm run supabase:catalog:e2e` passed with organization `1b3ac8a4-a422-4c18-aee5-2d6d86d29f07`,
  branch `5e635b70-e2b0-4717-8ebc-8a43b71b7847`, item `2987406e-98c7-4e8e-80a9-227bfe155ef3`,
  variant `e76aa7e8-59f3-40c7-bf8a-9ef26c3b34b7`, availability rule
  `013b748e-6a51-4fd6-b01f-4cacd56b9ac8`, and orderability check
  `a11caa1b-2b6d-46af-9799-c85cfe3280a3`.
- `npm run supabase:orders:e2e` passed with order `575e4331-7cff-4bae-b8e1-0502bda9e5d0` and service
  request `0436d226-fb20-4dc4-b4e2-8609a8cd05fd`.
- `npm run supabase:backend:e2e` passed with service request `5f0c5ffa-2063-41fd-babb-56a88e0856f0`.
- `npm run supabase:webhook:dead-letter` passed with webhook delivery
  `77694e51-b988-460a-a9fd-3d451a6799fa`.
- `npm run supabase:finance-communication:e2e` passed with deposit
  `38d84d40-18e4-46f1-95a1-f382d9b1d85e`, withdrawal `cc95947f-2784-459f-bb2e-22c73c4deeb3`,
  communication message `92f5dc5f-080c-4488-bb65-2d8d9853ef0b`, OTP challenge
  `f23e8bd1-d215-445a-89e9-598242944b19`, order `a80de045-ee24-4e03-bd79-11898c9fe385`, escrow hold
  `9ebc8534-d74b-441e-8497-225209cf6147`, commission execution
  `90918e73-3399-4ade-a13d-f3b6a1790e0c`, and settlement statement
  `de906498-8f76-4954-b5a6-2490c9d6f25a`.

## Milestone 1 Audit

| Requirement                             | Status   | Current Evidence                                                                                                           | Remaining Work                                                                                |
| --------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Supabase Auth users and profiles        | Complete | Supabase Auth trigger provisions `public.profiles`; real super admin auth gate passed.                                     | Reviewer approval.                                                                            |
| Platform admins and role templates      | Complete | Super admin, multiple role-based admin templates, admin API routes, and real super-admin remote gate passed.               | Reviewer approval and future role-template expansion as operations grow.                      |
| Organizations and memberships           | Complete | Organization branches, invitations, branch-scoped roles, suspension/reactivation, ownership transfer, and E2E proof exist. | Reviewer approval and broader negative tests as hardening work.                               |
| Storage and media metadata              | Complete | Private buckets, object policies, document registration/review RPCs, and hosted document lifecycle evidence exist.         | Document expiry worker and quarantine provider execution before high-risk production uploads. |
| Audit, logs, health, rate limits, cache | Complete | Audit append-only, logging, health, rate-limit, cache helpers, worker and webhook negative-auth checks passed.             | Production paid-plan PITR/Log Drains or equivalent alerting before public launch.             |
| Communication foundation                | Complete | Communication messages, channel support, delivery sync, OTP challenges, OTP attempts, and hosted E2E evidence exist.       | Live channel provider certification before public production use.                             |

## Milestone 2 Audit

| Requirement                    | Status   | Current Evidence                                                                                                                     | Remaining Work                                                                            |
| ------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Pricing execution              | Complete | `calculate_price_quote`, quote acceptance, policy snapshots, and hosted backend lifecycle proof exist.                               | Broader policy-mode edge-case gates.                                                      |
| Wallet ledger                  | Complete | Wallet balances are derived from append-only double-entry ledger entries; ledger immutability and finance lifecycle gates passed.    | Reviewer approval.                                                                        |
| Escrow execution               | Complete | Hold, release, refund, dispute/expiry status functions exist; order funding/commission/settlement gate passed.                       | Broader refund, dispute, partial release, and expiry gates.                               |
| Settlement execution           | Complete | Settlement execution, settlement statements, platform fee split, duplicate prevention, and reconciliation gate passed.               | Live payout provider certification and schedule automation before public launch.          |
| Driver commission              | Complete | Configured commission policy, execution receipt, ledger credit, and duplicate prevention gate passed.                                | Broader bonus, penalty, distance, weight, time, and reversal policy gates.                |
| Dispatch execution             | Complete | Runtime selects eligible approved drivers with active approved driver-vehicle links and driver/vehicle capability matches.           | Broader distance, capacity, zone, priority, and manual-override policy tests.             |
| Tracking execution             | Complete | Tracking sessions and point ingestion exist; lifecycle gate persists tracking updates.                                               | Live map/ETA provider certification and geofence edge-case gates.                         |
| Verification execution         | Complete | Verification events can trigger configured workflow events; lifecycle gate covers pickup, fulfilment, and delivery verification.     | Broader scan failure and idempotency edge-case gates.                                     |
| Payment provider engine        | Complete | Sandbox NGN payment adapter initializes deposits, processes signed webhooks, rejects duplicates safely, and posts ledger entries.    | Live NGN provider credentials, signature certification, and operational reconciliation.   |
| Withdrawal engine              | Complete | Beneficiary validation, request, approval, reserve, transfer success, transfer failure reversal, and reconciliation gate passed.     | Live transfer provider certification and broader fee/limit policy gates.                  |
| Notification and communication | Complete | Notification worker, communication messages, delivery sync, OTP request/verify, append-only attempts, and hosted E2E evidence exist. | Live email, SMS, WhatsApp credentials and provider certification.                         |
| AI orchestration               | Complete | AI task queue, sandbox adapter, provider catalog, and worker execution exist.                                                        | Live Gemini certification, cost/rate monitoring, and schema validation hardening.         |
| Maps/location adapter          | Complete | Map request records and provider catalog exist; tracking data remains backend-owned.                                                 | Live route/ETA/geocode adapter certification.                                             |
| Workers and dead letters       | Complete | Runtime worker, signed payment webhook, signed outbound webhook, retry/dead-letter, finance, and communication gates passed.         | Additional scheduled worker coverage for expiry, reconciliation, and production alerting. |

## Milestone 3 Audit

| Requirement                 | Status   | Current Evidence                                                                                                                                  | Remaining Work                                                                      |
| --------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Business module framework   | Complete | Module registry, versions, component bindings, events, activation validation, and gateway routes exist.                                           | Reviewer approval.                                                                  |
| LPG as first module         | Complete | LPG is configured through module records and engine bindings with no LPG-specific platform functions.                                             | Real launch tuning through configuration, not platform core edits.                  |
| Business application engine | Complete | Application records, review workflow, correction/resubmit, document review, approval, organization/partner activation, and E2E evidence exist.    | Broader suspension/reactivation negative-path gates.                                |
| Driver application engine   | Complete | Driver/vehicle applications, required documents, activation, capabilities, approved driver-vehicle links, and E2E proof exist.                    | Broader fleet assignment, expiry, and ownership-transfer gates.                     |
| Business staff management   | Complete | Invitations, acceptance, custom organization roles, branch scoping, suspension/reactivation, ownership transfer, and E2E evidence exist.          | Broader cross-organization negative gates and richer role-template coverage.        |
| Catalog and availability    | Complete | Products/services, categories, variants, units, prices, media, branch availability, stock/capacity, orderability, and E2E evidence exist.         | Broader discount, tax, schedule, effective-date, and capacity edge-case gates.      |
| Order processing            | Complete | Catalog-backed order creation, branch-scoped processing, assignment, stock reservation/consumption, events, notifications, and E2E proof exist.   | Broader rejection, cancellation, dispute, timeout, reassignment, and partial gates. |
| Finance-backed lifecycle    | Complete | Deposit, withdrawal, escrow funding, driver commission, business settlement, communication, OTP, and reconciliation gate passed without frontend. | Live provider certification before public production money or messages are enabled. |

## Decision

Milestones 1-3 are `Complete` for hosted development backend evidence and remain
`Pending reviewer
approval`.

Milestone 4 remains `Not Started` until the reviewer accepts this evidence.

Public production launch remains blocked by live provider certification and production operations
hardening, not by missing Milestones 1-3 backend runtime.
