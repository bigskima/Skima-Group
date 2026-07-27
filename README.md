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
- Supabase Edge Functions for health checks and API gateway entrypoints
- Supabase Storage metadata through the platform storage/media tables

## Current Milestone

Milestone 1 is the reusable platform foundation. It intentionally contains no business module.

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
```

Docker is optional. Milestone 1 runtime validation uses a dedicated hosted Supabase development
project through `supabase db push` and `supabase functions deploy`.

See [Remote Supabase Dev Runbook](docs/runbooks/remote-supabase-dev.md).

## Authentication Foundation

App and admin clients authenticate through Supabase Auth with the client-safe helper in
`packages/auth`. Real Supabase Auth users are provisioned into `public.profiles` by the foundation
database trigger.

Admin access is not hardcoded. The platform has one service-role-bootstrapped super admin/general
manager and supports multiple role-based admins through `public.platform_admins`, `public.roles`,
and `public.user_roles`.
