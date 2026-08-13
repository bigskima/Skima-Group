# Skima Platform Roadmap

This tracker follows `SKIMA_PLATFORM_CONSTITUTION.md`. The reusable foundation remains, but the active Phase 1 launch product is Skima LPG.

## Current Status

- Milestone 1 status: Complete, pending reviewer approval. Foundation, storage, communication/OTP
  foundation, hosted security gates, and operational surfaces have hosted evidence.
- Milestone 2 status: Complete, pending reviewer approval. Runtime engines now include NGN deposits,
  signed payment webhooks, withdrawals, transfer success/failure reversal, commission, settlement,
  communication, OTP, and reconciliation gates.
- Milestone 3 status: Complete, pending reviewer approval. Module framework, LPG configuration,
  onboarding, staff, catalog, order operations, and finance-backed lifecycle have hosted evidence.
- Milestone 3 first LPG module configuration: live on hosted Supabase dev from the previous gate.
- Milestone 3 backend lifecycle gates: backend lifecycle, application/document, driver/vehicle,
  staff, catalog, and order operations have hosted proof.
- Milestone 4 status: In Progress. Frontend work is now focused on productionizing the dedicated Skima LPG launch mobile app and LPG operations web tooling.
- Financial posting now uses a balanced idempotent database engine.
- Wallet accounts now have real provisioning/status engines live on hosted Supabase dev.
- Workflow and event runtime changes now use idempotent database engines.
- Dispatch, tracking, verification, notification, maps, and AI runtime commands now have idempotent
  database engines live on hosted Supabase dev.
- Runtime strategy: hosted Supabase dev project through `supabase db push` and function deploy.
  Docker is optional, not a milestone blocker.
- Runtime worker and payment webhook functions are required backend surfaces.
- Latest finance/communication gate passed with order `a80de045-ee24-4e03-bd79-11898c9fe385`,
  commission execution `90918e73-3399-4ade-a13d-f3b6a1790e0c`, and settlement statement
  `de906498-8f76-4954-b5a6-2490c9d6f25a`.

## Milestone 1: Platform Foundation

- [x] Authentication Engine
- [x] Authorization Engine
- [x] User Engine
- [x] Role Engine
- [x] Permission Engine
- [x] Organization Engine
- [x] Partner Engine
- [x] Driver Engine
- [x] Vehicle Engine
- [x] Asset Engine
- [x] Media Engine
- [x] Storage Engine
- [x] Configuration Engine
- [x] Audit Engine
- [x] Logging Engine
- [x] Error Engine
- [x] Queue Engine
- [x] Background Jobs
- [x] Webhooks
- [x] API Gateway
- [x] Rate Limiting
- [x] Caching
- [x] Database foundation
- [x] Edge Functions foundation
- [x] Security baseline
- [x] Health Monitoring
- [x] Documentation baseline

## Milestone 1 Production Gate

- [x] Root verification scripts exist.
- [x] Shared TypeScript contracts compile.
- [x] Static validation confirms business-agnostic boundaries.
- [x] Static validation confirms RLS coverage in the Supabase migration.
- [x] Remote Supabase scripts exist for link, database push, function deploy, status, bootstrap, and
      RLS checks.
- [x] Hosted Supabase dev project is linked with `npm run supabase:link`.
- [x] Supabase migration applies successfully with `npm run supabase:db:push`.
- [x] Edge Functions deploy with `npm run supabase:functions:deploy`.
- [x] First platform admin bootstrap is verified with a real Supabase Auth user.
- [x] Remote runtime checks pass for health, JWT enforcement, anon denial, service-role operations,
      and append-only audit logs.
- [x] Authenticated-user RLS checks use real super admin authentication.
- [x] Client-safe Supabase Auth helper exists for real user sign-up, sign-in, session refresh,
      current-user lookup, and sign-out.
- [x] App/client env example exposes only `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
- [x] Supabase runtime secrets are configured with `supabase secrets set`.
- [x] Deployment-only values are stored in shell or CI secrets, never app env files.
- [ ] Production backup and point-in-time recovery settings are confirmed.
- [ ] Monitoring alerts are configured.

## Milestone 2: Reusable Platform Engines

- [x] Workflow Engine storage with database-stored workflows, runtime instances, and transition
      receipts
- [x] Event Engine storage with handler configuration and controlled event recording
- [x] Verification Event Engine storage and runtime recording RPC
- [x] Pricing Engine policy storage
- [x] Settlement Engine policy storage
- [x] Wallet Engine account provisioning, status runtime, receipts, and append-only ledger storage
      with direct inserts blocked by RLS
- [x] Financial Engine transaction storage with balanced idempotent posting RPC
- [x] Currency Engine with NGN active for Phase One
- [x] Payment Provider Engine through replaceable provider adapters
- [x] Escrow Engine hold storage
- [x] Dispatch Engine policy, request, candidate, assignment runtime, and receipt storage
- [x] Tracking Engine session, point runtime, and receipt storage
- [x] Maps Adapter request storage and queue RPC
- [x] Notification Engine template, message runtime, and receipt storage
- [x] AI Engine task definition, run runtime, and receipt storage
- [x] Executable pricing calculation
- [x] Escrow hold, release, refund, dispute-state, and expiry RPCs
- [x] Settlement distribution execution
- [x] Provider execution logs
- [x] Runtime worker for notifications, AI tasks, jobs, expirations, and health recording
- [x] Payment webhook handler with server-side secret validation
- [x] Reconciliation RPC
- [x] Hosted Supabase remote gate after runtime remediation for current runtime checks
- [x] No-frontend backend lifecycle E2E after runtime remediation
- [x] Real NGN deposit/payment provider gate through sandbox adapter
- [x] Withdrawal/transfer/reversal gate through sandbox adapter
- [x] Commission and settlement hardening gate
- [x] Communication and OTP gate

## Financial Policy Governance (mandatory cross-platform hardening)

- [ ] Implement the reusable, backend-authoritative financial policy lifecycle defined in
      `docs/32-financial-policy-governance-directive.md`: scoped immutable versions, approvals,
      effective dating, conflict prevention, audit history, and safe rollback.
- [ ] Provide authorized company-admin policy APIs and UI; restrict delegated partner/station scope
      and prohibit customer/driver authority over financial rules.
- [ ] Snapshot resolved policy/configuration and financial composition in accepted quotes, orders,
      and active obligations; make later changes future-effective only.
- [ ] Replace client-supplied authoritative fee, commission-base, payout, and settlement amounts
      with server-side policy-derived calculations.
- [ ] Add automated governance coverage for RBAC, delegated scope, approvals, overlap prevention,
      effective dating, audit records, rollback, and snapshot immutability.

## Milestone 3: Business Module Framework

- [x] Module registry
- [x] Module versioning
- [x] Module lifecycle event receipts
- [x] Module capability definitions
- [x] Module workflow definitions
- [x] Module pricing policy definitions
- [x] Module settlement policy definitions
- [x] Module dispatch policy component binding
- [x] Module event definitions
- [x] Module permission definitions
- [x] Module vehicle and driver requirements
- [x] Module document requirements
- [x] Module AI behavior definitions
- [x] Module report definitions
- [x] Module screen definitions
- [x] Module configuration RPCs
- [x] Module API gateway routes
- [x] LPG module configuration
- [x] No-frontend lifecycle gate script
- [x] Business application and document lifecycle gate
- [x] Driver and vehicle onboarding lifecycle gate
- [x] Organization staff lifecycle gate
- [x] Catalog and availability lifecycle gate
- [x] Order operations lifecycle gate
- [x] Hosted lifecycle gates passed
- [ ] Reviewer approves Milestone 3 backend evidence

## Milestone 4: Reusable Frontend Foundation

- [x] Milestone 4 scope corrected to Skima LPG launch product, not a generic service marketplace
- [x] Dedicated `apps/lpg-mobile` launch app exists for customer, driver, and station LPG workspaces
- [x] LPG workspace tabs match the approved customer, driver, and station contracts
- [ ] Design system tokens
- [ ] Buttons
- [ ] Cards
- [ ] Forms
- [ ] Inputs
- [ ] Dropdowns
- [ ] Search
- [ ] Filters
- [ ] Lists
- [ ] Tables
- [ ] Navigation
- [ ] Sidebar
- [ ] Bottom navigation
- [ ] Headers
- [ ] Maps
- [ ] QR components
- [ ] Wallet components
- [ ] Notification components
- [ ] Charts
- [ ] Dialogs
- [ ] Loading states
- [ ] Error states
- [ ] Themes

## Milestone 5: Platform Expansion

- [ ] Restaurant module
- [ ] Ride hailing module
- [ ] Pharmacy module
- [ ] Laundry module
- [ ] Courier module
- [ ] Marketplace module
- [ ] Water delivery module
- [ ] Construction materials module
- [ ] Healthcare logistics module
- [ ] Future business modules through configuration

## Agent Gate Before Every Code Change

- [ ] Is this reusable?
- [ ] Is this business-agnostic?
- [ ] Can another service use it?
- [ ] Is this configuration instead of hardcoding?
- [ ] Can this be an engine instead of a feature?
- [ ] Can this be an event instead of a conditional?
- [ ] Can this be a workflow instead of business logic?
- [ ] Can providers be swapped through adapters?
- [ ] Can currencies be enabled through configuration?
- [ ] Can payment policies change without code changes?
- [ ] Will this still work if 100 new business modules are added?
