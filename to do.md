# Skima Platform Roadmap

This tracker follows `SKIMA_PLATFORM_CONSTITUTION.md`. LPG is the first module only after the
reusable platform foundation and business module framework exist.

## Current Status

- Milestone 1 status: In Progress. Foundation exists, but operational hardening evidence is not
  approved.
- Milestone 2 status: In Progress. Executable runtime remediation exists locally; hosted remote
  proof and E2E approval are pending.
- Milestone 3 status: Implemented but Untested. Module framework and LPG configuration exist, but
  the full no-frontend lifecycle is not approved.
- Milestone 3 first LPG module configuration: live on hosted Supabase dev from the previous gate.
- Milestone 3 backend lifecycle gate: pending after the runtime remediation migration is pushed.
- Milestone 4 status: Not Started. Frontend foundation is paused until backend milestones 1-3 are
  approved.
- Financial posting now uses a balanced idempotent database engine.
- Wallet accounts now have real provisioning/status engines live on hosted Supabase dev.
- Workflow and event runtime changes now use idempotent database engines.
- Dispatch, tracking, verification, notification, maps, and AI runtime commands now have idempotent
  database engines live on hosted Supabase dev.
- Runtime strategy: hosted Supabase dev project through `supabase db push` and function deploy.
  Docker is optional, not a milestone blocker.
- Runtime worker and payment webhook functions are required backend surfaces.

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
- [ ] Supabase runtime secrets are configured with `supabase secrets set`.
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
- [ ] Hosted Supabase remote gate after runtime remediation
- [ ] No-frontend backend lifecycle E2E after runtime remediation

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
- [ ] Hosted lifecycle gate passed and evidence reviewed

## Milestone 4: Reusable Frontend Foundation

- [ ] Blocked until backend milestones 1-3 are approved
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
