# Authentication Foundation

Skima uses Supabase Auth as the identity provider for Milestone 1.

## Client Boundary

App and browser code may only receive:

```bash
SUPABASE_URL=
SUPABASE_ANON_KEY=
```

The app signs up, signs in, refreshes sessions, fetches the current user, and signs out through the
client-safe auth helper in `packages/auth`.

## Server Boundary

These values are never app-side:

- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DB_PASSWORD`
- Bootstrap user IDs

Service-role operations belong in deployment shells, CI secrets, or Supabase runtime secrets.

## User Provisioning

The foundation migration attaches a trigger to `auth.users`. Every real Supabase Auth user receives
a matching `public.profiles` row.

Do not create placeholder members. User, member, and platform-admin RLS verification must use real
authenticated users after the authentication path is running.

## Platform Admin Governance

The first super admin/general manager must be an existing Supabase Auth user. Bootstrap is performed
with a service-role deployment command:

```bash
SKIMA_SUPER_ADMIN_USER_ID=<auth-user-uuid> npm run supabase:bootstrap-admin
```

The bootstrap RPC is not available to anonymous or authenticated client roles. After bootstrap,
additional admins are real Supabase Auth users recorded in `public.platform_admins` and assigned
global roles through `public.user_roles`.

Admin categories are database-configured through `public.platform_admin_role_templates`. A support
admin, finance admin, risk admin, or future admin role is created by defining a role template and
its permission keys, then assigning real users to that role.
