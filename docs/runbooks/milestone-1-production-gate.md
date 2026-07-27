# Milestone 1 Production Gate

Milestone 2 may not start until this checklist is complete.

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
- [ ] Supabase runtime secrets are configured with `supabase secrets set`.
- [x] Deployment-only values are stored in shell or CI secrets, never app env files.
- [ ] Production backup and point-in-time recovery settings are confirmed in Supabase.

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
- [x] Job queue tables exist.
- [x] Webhook tables exist.
- [x] Rate limit tables exist.
- [x] Cache tables exist.
- [x] Logging and error tables exist.
- [x] Edge Functions are deployed to the hosted Supabase dev project.
- [x] Remote production verification is completed against the hosted Supabase dev project.
- [ ] Monitoring alerts are configured in the production Supabase project.

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
```

Use a dedicated hosted Supabase development project. Do not run these commands against production
until Milestone 1 has passed the hosted dev gate.

Only `SUPABASE_URL` and `SUPABASE_ANON_KEY` are app/client-safe. Service role keys, database
passwords, and bootstrap IDs are deployment-only or Supabase runtime secrets.

Do not add placeholder member credentials to app env files. User, member, and admin RLS scenarios
must use real authenticated users.
