# Backend Domain Audit

Date: 2026-07-30.

Supersession note, 2026-08-01: this audit remains evidence for shared platform systems, but its
Milestone 4 unblocking decision is superseded for LPG by
`docs/32-lpg-backend-first-reset-audit.md`. LPG frontend production work remains blocked until the
complete backend-owned LPG journey passes end to end.

Milestones 1-3 backend evidence was reviewer-approved on 2026-07-30. At that time, Milestone 4
reusable frontend foundation work was considered unblocked under
`docs/runbooks/milestone-4-production-gate.md`; the 2026-08-01 LPG reset now blocks LPG frontend
production work until the new backend gate passes.

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

- `npm run supabase:remote:gate` passed on 2026-07-30 against hosted Supabase with a real platform
  super admin, including invalid Paystack signature rejection.
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
- `npm run supabase:finance-communication:e2e` passed on 2026-07-30 with deposit
  `40936159-8929-4f94-a77f-85a1dcc4920f`, withdrawal `e850b91d-c004-4072-8924-c8b82435d1ac`,
  communication message `9ebd3533-fcdf-4ca2-859a-ac2822670ec2`, OTP challenge
  `467130d9-e4fc-4899-8d21-b2dfb80beab4`, order `cb04fa79-c4bf-43fe-8e14-d58701cda5e9`, escrow hold
  `21e5e8a2-9f09-4bee-9d5a-7ee1aa8a9ba7`, commission execution
  `fa391d9b-c02d-433e-80f5-487f8bc5b704`, and settlement statement
  `9add94af-910b-4eb3-9ffc-da4239ca4488`.

## Milestone 1 Audit

| Requirement                             | Status   | Current Evidence                                                                                                                                               | Remaining Work                                                                                |
| --------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Supabase Auth users and profiles        | Approved | Supabase Auth trigger provisions `public.profiles`; real super admin auth gate passed.                                                                         | Approved on 2026-07-30.                                                                       |
| Platform admins and role templates      | Approved | Super admin, multiple role-based admin templates, admin API routes, and real super-admin remote gate passed.                                                   | Future role-template expansion as operations grow.                                            |
| Organizations and memberships           | Approved | Organization branches, invitations, branch-scoped roles, suspension/reactivation, ownership transfer, and E2E proof exist.                                     | Broader negative tests as hardening work.                                                     |
| Storage and media metadata              | Approved | Private buckets, object policies, document registration/review RPCs, and hosted document lifecycle evidence exist.                                             | Document expiry worker and quarantine provider execution before high-risk production uploads. |
| Audit, logs, health, rate limits, cache | Approved | Audit append-only, logging, health, rate-limit, cache helpers, worker and webhook negative-auth checks passed.                                                 | Production paid-plan PITR/Log Drains or equivalent alerting before public launch.             |
| Communication foundation                | Approved | Communication messages, channel support, delivery sync, OTP challenges, protected owner-only in-app OTP delivery, OTP attempts, and hosted E2E evidence exist. | Live channel provider certification before public production use.                             |

## Milestone 2 Audit

| Requirement                    | Status   | Current Evidence                                                                                                                                                                                                                               | Remaining Work                                                                            |
| ------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Pricing execution              | Approved | `calculate_price_quote`, quote acceptance, policy snapshots, and hosted backend lifecycle proof exist.                                                                                                                                         | Broader policy-mode edge-case gates.                                                      |
| Wallet ledger                  | Approved | Wallet balances are derived from append-only double-entry ledger entries; ledger immutability and finance lifecycle gates passed.                                                                                                              | Approved on 2026-07-30.                                                                   |
| Escrow execution               | Approved | Hold, release, refund, dispute/expiry status functions exist; order funding/commission/settlement gate passed.                                                                                                                                 | Broader refund, dispute, partial release, and expiry gates.                               |
| Settlement execution           | Approved | Settlement execution, settlement statements, platform fee split, duplicate prevention, and reconciliation gate passed.                                                                                                                         | Live payout provider certification and schedule automation before public launch.          |
| Driver commission              | Approved | Configured commission policy, execution receipt, ledger credit, and duplicate prevention gate passed.                                                                                                                                          | Broader bonus, penalty, distance, weight, time, and reversal policy gates.                |
| Dispatch execution             | Approved | Runtime selects eligible approved drivers with active approved driver-vehicle links and driver/vehicle capability matches.                                                                                                                     | Broader distance, capacity, zone, priority, and manual-override policy tests.             |
| Tracking execution             | Approved | Tracking sessions and point ingestion exist; lifecycle gate persists tracking updates.                                                                                                                                                         | Live map/ETA provider certification and geofence edge-case gates.                         |
| Verification execution         | Approved | Verification events can trigger configured workflow events; lifecycle gate covers pickup, fulfilment, and delivery verification.                                                                                                               | Broader scan failure and idempotency edge-case gates.                                     |
| Payment provider engine        | Approved | Sandbox NGN payment adapter and Paystack adapter paths exist; Paystack initialization is server-side, webhooks require `x-paystack-signature`, duplicates are rejected safely, and ledger entries are posted only for verified webhook events. | Paystack Dashboard account/webhook/payout certification and operational reconciliation.   |
| Withdrawal engine              | Approved | Beneficiary validation, request, approval, reserve, transfer success, transfer failure reversal, and reconciliation gate passed.                                                                                                               | Live transfer provider certification and broader fee/limit policy gates.                  |
| Notification and communication | Approved | Notification worker, communication messages, delivery sync, protected in-app OTP fetch, OTP request/verify, append-only delivery/access/attempt records, and hosted E2E evidence exist.                                                        | Live email, SMS, WhatsApp credentials and provider certification.                         |
| AI orchestration               | Approved | AI task queue, sandbox adapter, provider catalog, and worker execution exist.                                                                                                                                                                  | Live Gemini certification, cost/rate monitoring, and schema validation hardening.         |
| Maps/location adapter          | Approved | Map request records and provider catalog exist; tracking data remains backend-owned.                                                                                                                                                           | Live route/ETA/geocode adapter certification.                                             |
| Workers and dead letters       | Approved | Runtime worker, signed payment webhook, signed outbound webhook, retry/dead-letter, finance, and communication gates passed.                                                                                                                   | Additional scheduled worker coverage for expiry, reconciliation, and production alerting. |

## Milestone 3 Audit

| Requirement                 | Status   | Current Evidence                                                                                                                                                            | Remaining Work                                                                      |
| --------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Business module framework   | Approved | Module registry, versions, component bindings, events, activation validation, and gateway routes exist.                                                                     | Approved on 2026-07-30.                                                             |
| LPG as first module         | Approved | LPG is configured through module records and engine bindings with no LPG-specific platform functions.                                                                       | Real launch tuning through configuration, not platform core edits.                  |
| Business application engine | Approved | Application records, review workflow, correction/resubmit, document review, approval, organization/partner activation, and E2E evidence exist.                              | Broader suspension/reactivation negative-path gates.                                |
| Driver application engine   | Approved | Driver/vehicle applications, required documents, activation, capabilities, approved driver-vehicle links, and E2E proof exist.                                              | Broader fleet assignment, expiry, and ownership-transfer gates.                     |
| Business staff management   | Approved | Invitations, acceptance, custom organization roles, branch scoping, suspension/reactivation, ownership transfer, and E2E evidence exist.                                    | Broader cross-organization negative gates and richer role-template coverage.        |
| Catalog and availability    | Approved | Products/services, categories, variants, units, prices, media, branch availability, stock/capacity, orderability, and E2E evidence exist.                                   | Broader discount, tax, schedule, effective-date, and capacity edge-case gates.      |
| Order processing            | Approved | Catalog-backed order creation, branch-scoped processing, assignment, stock reservation/consumption, events, notifications, and E2E proof exist.                             | Broader rejection, cancellation, dispute, timeout, reassignment, and partial gates. |
| Finance-backed lifecycle    | Approved | Deposit, withdrawal, escrow funding, driver commission, business settlement, communication, protected in-app OTP delivery, and reconciliation gate passed without frontend. | Paystack provider certification before public production money is enabled.          |

## Decision

Milestones 1-3 are `Approved` for hosted development backend evidence.

Milestone 4 reusable frontend foundation evidence from this audit is no longer sufficient to resume
LPG frontend production work. The LPG backend-first reset gate in
`docs/32-lpg-backend-first-reset-audit.md` must pass first.

Public production launch remains blocked by Paystack account/webhook/payout certification and
production operations hardening, not by missing Milestones 1-3 backend runtime.
