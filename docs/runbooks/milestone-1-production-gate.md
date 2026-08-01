# Milestone 1 Production Gate

Milestone 2 may not start until this checklist is complete. Because the backend-first directive was
expanded on 2026-07-28, this milestone was reopened for foundation-level storage, communication,
OTP, and role-specific security evidence.

Current status: Approved on 2026-07-30.

## Local Verification

- [x] Root verification scripts exist.
- [x] Shared TypeScript contracts compile with Deno.
- [x] Static validation confirms business-agnostic source boundaries.
- [x] Static validation confirms RLS coverage in the Supabase migration.
- [x] Docker is not required for the Milestone 1 runtime gate.
- [x] Hosted Supabase dev project is linked with `npm run supabase:link`.
- [x] Hosted Supabase dev database contains only the new foundation schema.
- [x] Supabase migration applies successfully to the hosted dev project.
- [x] First platform super admin bootstrap is verified with a real Supabase Auth user.
- [x] Remote runtime verification passes for health, JWT enforcement, anon denial, service-role
      operations, and append-only audit logs.
- [x] Authenticated-user RLS verification uses real Supabase Auth sessions.

## Security Gate

- [x] RLS is enabled for every platform table in the foundation migration.
- [x] Audit logs are append-only.
- [x] Privilege escalation triggers exist for profile and driver verification changes.
- [x] Service-role-only bootstrap function exists.
- [x] Platform admin governance supports one super admin and multiple role-based admins.
- [x] Future platform admin categories are database-configured through role templates.
- [x] Provider records store secret references instead of plaintext secrets.
- [x] App/client env example exposes only `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
- [x] Supabase runtime secrets are configured with `supabase secrets set`.
- [x] Deployment-only values are stored in shell or CI secrets, never app env files.
- [x] Hosted dev backup/PITR availability is assessed. PITR is not available on the current Supabase
      Free plan and is recorded as a production-launch hardening requirement.

## Architecture Gate

- [x] No business module is implemented.
- [x] No business-specific workflow is implemented.
- [x] Workflows are database-defined.
- [x] Events are database-defined.
- [x] Provider adapters are replaceable by configuration.
- [x] Currency activation is configuration-driven.

## Operational Gate

- [x] Health Edge Function exists.
- [x] API Gateway Edge Function exists.
- [x] Runtime worker Edge Function exists.
- [x] Payment webhook Edge Function exists.
- [x] Sandbox outbound webhook receiver Edge Function exists.
- [x] Database-backed API rate-limit check exists.
- [x] Cache runtime helpers exist.
- [x] Health recording runtime helper exists.
- [x] Job queue tables exist.
- [x] Webhook tables exist.
- [x] Rate limit tables exist.
- [x] Cache tables exist.
- [x] Logging and error tables exist.
- [x] Edge Functions are deployed to the hosted Supabase dev project after the application/document
      route normalization update.
- [x] Remote production verification is completed against the hosted Supabase dev project after the
      webhook delivery runtime gate is added.
- [x] Hosted dev Edge Function invocations/logs are visible in Supabase dashboard.
- [x] Log Drains are not available on the current Supabase Free plan and are recorded as a
      production-launch hardening requirement.
- [x] Supabase Storage buckets and object-level policies are implemented locally for platform
      documents and media in `20260728070000_application_document_runtime.sql`.
- [x] Reusable document upload registration and review metadata is implemented locally.
- [x] Hosted dev migration applied for storage, document, and application runtime.
- [x] Hosted E2E evidence proves document storage policy, registration, review, audit, and
      append-only behavior.
- [x] Communication and OTP foundation tables, policies, runtime functions, and workers are
      implemented.
- [x] Role-specific RLS/security gates cover customer, business owner, business staff, driver,
      support admin, finance admin, module admin, and super admin.

## Production Launch Follow-Up

- [ ] Enable or confirm production-grade backup/PITR on the production Supabase plan before launch.
- [ ] Configure production alerting through Log Drains or an equivalent paid-plan observability
      provider before launch.

## Required Remote Commands

Run these in order:

```bash
npm run verify
supabase login
npm run supabase:link
npm run supabase:db:push
npm run supabase:functions:deploy
npm run supabase:provision-admin
npm run supabase:remote:gate
npm run supabase:applications:e2e
npm run supabase:finance-communication:e2e
```

Set `SKIMA_WORKER_SECRET`, `SKIMA_PAYMENT_WEBHOOK_SECRET`, and
`SKIMA_OUTBOUND_WEBHOOK_SANDBOX_SECRET` with `supabase secrets set` before deploying runtime
functions and running the backend lifecycle gate.

Use a dedicated hosted Supabase development project. Do not run these commands against production
until Milestone 1 has passed the hosted dev gate.

Only `SUPABASE_URL` and `SUPABASE_ANON_KEY` are app/client-safe. Service role keys, database
passwords, and bootstrap IDs are deployment-only or Supabase runtime secrets.

Do not add placeholder member credentials to app env files. User, member, and admin RLS scenarios
must use real authenticated users.
