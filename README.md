# Skima Platform

Skima is a universal, AI-first operating system for logistics, commerce, mobility, and fulfillment.

This repository is starting from a clean platform foundation. The governing source of truth is:

- [SKIMA_PLATFORM_CONSTITUTION.md](SKIMA_PLATFORM_CONSTITUTION.md)
- [AGENTS.md](AGENTS.md)
- [to do.md](to%20do.md)

## Backend

The backend foundation uses Supabase:

- Supabase Auth for identity
- Supabase Postgres for platform data, policies, workflows, events, audit logs, and configuration
- Supabase Row Level Security from the first migration
- Supabase Edge Functions for health checks, authenticated APIs, runtime workers, and webhooks
- Supabase Storage metadata through the platform storage/media tables

## Current Milestone

The active work is backend-first remediation for Milestones 1-3.

Milestone status is evidence-based:

- Milestone 1: In Progress
- Milestone 2: In Progress
- Milestone 3: Implemented but Untested
- Milestone 4: Not Started

LPG remains the first module and is configured as database records and engine bindings, not platform
source-code logic.

Milestone 4 is paused. No frontend or UI implementation starts until backend milestones 1-3 have
production-readiness evidence and reviewer approval.

## Verification

Run:

```bash
npm run verify
```

## Remote Supabase Runtime

Only `SUPABASE_URL` and `SUPABASE_ANON_KEY` belong in app/client env files. Privileged deployment
values must come from the shell or CI secrets, and Edge Function runtime secrets must be stored with
`supabase secrets set`.

```bash
supabase login
npm run supabase:link
npm run supabase:db:push
npm run supabase:functions:deploy
npm run supabase:remote:gate
npm run supabase:backend:e2e
```

Docker is optional. Runtime validation uses a dedicated hosted Supabase development project through
`supabase db push` and `supabase functions deploy`.

See [Remote Supabase Dev Runbook](docs/runbooks/remote-supabase-dev.md).

Required Edge Function secrets are stored in Supabase, not in app env files:

- `SKIMA_WORKER_SECRET`
- `SKIMA_PAYMENT_WEBHOOK_SECRET`
- sandbox provider secrets such as `SKIMA_SANDBOX_PAYMENT_SECRET`

## Authentication Foundation

App and admin clients authenticate through Supabase Auth with the client-safe helper in
`packages/auth`. Real Supabase Auth users are provisioned into `public.profiles` by the foundation
database trigger.

Admin access is not hardcoded. The platform has one service-role-bootstrapped super admin/general
manager and supports multiple role-based admins through `public.platform_admins`, `public.roles`,
and `public.user_roles`.
