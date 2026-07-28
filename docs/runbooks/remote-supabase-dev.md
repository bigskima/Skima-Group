# Remote Supabase Dev Runbook

This is the no-Docker runtime path for the Supabase-backed platform foundation and reusable engine
milestones.

## 1. Create a Hosted Dev Project

Create a dedicated Supabase project for development, for example `skima-platform-dev`.

Do not use the production project for foundation validation.

## 2. Configure Local Environment

`.env.example` is for app/client-safe values only:

```bash
SUPABASE_URL=https://<hosted-dev-project-ref>.supabase.co
SUPABASE_ANON_KEY=<anon-key>
```

Do not place privileged values in app-side env files.

Deployment-only values must come from the shell, CI secret store, or a password manager session:

```bash
SUPABASE_PROJECT_REF=<hosted-dev-project-ref>
SUPABASE_DB_PASSWORD=<database-password>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
```

Runtime server-side secrets for Edge Functions must be stored in Supabase secrets:

```bash
supabase secrets set SKIMA_WORKER_SECRET=<worker-secret> --project-ref <hosted-dev-project-ref>
supabase secrets set SKIMA_PAYMENT_WEBHOOK_SECRET=<webhook-secret> --project-ref <hosted-dev-project-ref>
```

Sandbox provider secrets are also server-side only when enabled, for example
`SKIMA_SANDBOX_PAYMENT_SECRET`, `SKIMA_SANDBOX_NOTIFICATION_SECRET`, `SKIMA_SANDBOX_MAPS_SECRET`,
and `SKIMA_SANDBOX_AI_SECRET`.

## 3. Link the Project

```bash
supabase login
npm run supabase:link
npm run supabase:remote:status
```

After linking, deployment scripts can read the project ref from `supabase/.temp/project-ref`.
`supabase:remote:status` checks CLI access to the hosted project.

## 4. Push Database Foundation

```bash
npm run verify
npm run supabase:db:push
```

This applies all pending platform foundation and reusable engine migrations to the hosted dev
project.

If the hosted dev project still contains old Skima schema objects from the previous build, reset the
dev database before the push:

```bash
SKIMA_ALLOW_REMOTE_DB_RESET=true npm run supabase:db:reset:linked
```

Run this only on the dedicated hosted development project.

## 5. Deploy Edge Functions

```bash
npm run supabase:functions:deploy
```

The deploy script uses Supabase CLI server-side bundling with `--use-api`, so Docker is not
required.

Expected function behavior:

- `health` is public and does not require a user JWT.
- `api-gateway` requires a user JWT.
- `runtime-worker` does not require a user JWT but requires `x-skima-worker-secret`.
- `payment-webhook` does not require a user JWT but requires `x-skima-webhook-secret`.
- `api-gateway/admin/role-templates` lists or configures admin role templates.
- `api-gateway/admin/users` lists or configures platform admin assignments.
- `api-gateway/admin/users/revoke` revokes a role-based platform admin assignment.
- `api-gateway/engines/catalog` lists reusable engine API routes.
- `api-gateway/engines/*` exposes read-oriented reusable engine catalogs through RLS.
- `api-gateway/modules/catalog` lists business module framework API routes.
- `api-gateway/modules/*` exposes module registry, version, component, and lifecycle records through
  RLS.
- `api-gateway/runtime/*` executes service requests, pricing, escrow, workflow events, dispatch,
  tracking, verification, notification queueing, AI queueing, settlement, and reconciliation.

The admin and module gateway routes delegate authorization to Supabase RLS and platform RPC
policies.

This is intentionally not one Edge Function per resource. Functions are split where security or
execution boundaries differ: public health, authenticated API, worker-secret runtime processing, and
provider-secret webhook intake.

## 6. Bootstrap the First Platform Admin

Skima supports one platform super admin/general manager plus multiple role-based admins. Login is
always Supabase Auth. Admin authority is stored in platform tables and role assignments.

Create or identify the first Supabase Auth user, then export the super admin user ID in the
deployment shell:

```bash
SKIMA_SUPER_ADMIN_USER_ID=<auth-user-uuid>
```

Run:

```bash
npm run supabase:bootstrap-admin
```

This calls the service-role-only `public.bootstrap_platform_super_admin(uuid)` RPC.

For a fresh hosted development project, invite the first real admin user directly from
deployment-shell secrets:

```bash
SKIMA_SUPER_ADMIN_EMAIL=<real-admin-email> \
npm run supabase:provision-admin
```

This creates a real Supabase Auth invite and bootstraps the platform super admin assignment for that
user. The email must not be committed to app env files.

For development environments that require direct password creation instead of invite email delivery,
provide `SKIMA_SUPER_ADMIN_PASSWORD` in the deployment shell. Do not commit it.

After the super admin exists, additional admins are configured through
`public.configure_platform_admin` with real Supabase Auth user IDs and active platform admin role
templates such as:

- `platform.identity_admin`
- `platform.configuration_admin`
- `platform.finance_admin`
- `platform.operations_admin`
- `platform.audit_admin`
- `platform.support_admin`

Future admin types do not require backend code changes. The super admin can create or update a
template by calling `public.configure_platform_admin_role` with a role key and permission list, then
assign users to it with `public.configure_platform_admin`.

## 7. Authenticated Users Come First

Milestone 1 uses real Supabase Auth users only.

Authenticated-user RLS scenarios are verified with real users after the authentication flow and user
provisioning path are in place. The first platform admin must be a real Supabase Auth user.

## 8. Complete Remote Production Verification

Before Milestone 3, provision the real platform-owned NGN foundation wallets:

```bash
npm run supabase:provision-platform-wallets
```

This creates or confirms the platform, escrow, commission, and refund wallets through
`ensure_wallet_account`. These are real foundation wallets with zero ledger balance until real money
movement is posted through `post_financial_transaction`.

Confirm this production gate against the hosted development project:

- public health function access
- JWT enforcement on `api-gateway`
- anonymous denial on protected tables
- service-role operational access for foundation records
- append-only audit logs
- real platform admin access to governed records

Authenticated-user profile, organization membership, and platform-admin RLS verification uses real
Supabase Auth sessions only.

`npm run supabase:remote:gate` verifies that exactly one active super admin assignment exists and
requires a real super admin session. Provide either `SKIMA_ADMIN_ACCESS_TOKEN` or
`SKIMA_SUPER_ADMIN_EMAIL` and `SKIMA_SUPER_ADMIN_PASSWORD` in the deployment shell.

The next milestone remains blocked until the relevant local and hosted Supabase gates pass against
the hosted dev project.

Milestone 3 also requires the first LPG module configuration to be pushed as database configuration.
After the migration is live, `npm run supabase:remote:gate` must confirm that LPG module version 1
is active and bound to its reusable pricing, settlement, workflow, dispatch, verification,
permission, report, screen, and AI components.

After runtime remediation is pushed and functions are deployed, run the full no-frontend lifecycle:

```bash
npm run supabase:backend:e2e
```

This requires `SKIMA_WORKER_SECRET` in the deployment shell so the script can call the deployed
runtime worker.
