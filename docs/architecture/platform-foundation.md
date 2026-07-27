# Platform Foundation Architecture

Milestone 1 builds the reusable Supabase-backed platform kernel only.

## Boundary

This milestone includes:

- Identity records mapped from Supabase Auth
- Organizations and memberships
- Role and permission authorization
- Partner, driver, vehicle, asset, media, and storage metadata foundations
- Configuration and provider adapter records
- Event, workflow, audit, logging, error, queue, webhook, API client, rate limit, cache, and health
  tables
- Supabase Edge Function entrypoints for health and API gateway routing

This milestone excludes:

- Business modules
- Business workflows
- Business pricing rules
- Business settlement rules
- Business-specific screens

## Supabase Responsibilities

Supabase owns:

- Authentication through Supabase Auth
- Durable data through Postgres
- Authorization through RLS policies and permission functions
- Edge execution through Edge Functions
- File storage through Supabase Storage, referenced by platform media metadata

## Production Rules

- Every table has RLS enabled in the first migration.
- Direct user access is restricted by policies, not application trust.
- Audit logs are append-only.
- Provider configuration stores secret references, not plaintext secrets.
- Workflows are stored in database records.
- Events are generic envelopes and never business-specific commands.
- The first platform admin is bootstrapped through a service-role-only function.

## Admin Bootstrap

After creating the first Supabase Auth user, call the bootstrap function using the service role:

```sql
select public.bootstrap_platform_admin('<auth-user-uuid>');
```

Do not expose this function through client code.
