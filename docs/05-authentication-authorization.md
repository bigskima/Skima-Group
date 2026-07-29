# Authentication And Authorization

Supabase Auth is the only identity provider.

Client-safe env:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

Privileged values must stay in deployment shell, CI secrets, or Supabase secrets.

Admin model:

- one active platform super admin/general manager
- multiple role-based platform admins
- configurable role templates and permissions

Application and document runtime permissions:

- `platform.applications.read`
- `platform.applications.manage`
- `platform.applications.review`
- `platform.documents.read`
- `platform.documents.manage`
- `platform.documents.review`
- organization-scoped business permissions such as `business.applications.manage`,
  `business.documents.manage`, `business.staff.manage`, `business.catalog.manage`,
  `business.orders.read`, `business.orders.process`, `business.orders.manage`,
  `business.finance.read`, and `business.settlements.read`
- finance and communication platform permissions such as `platform.payments.read`,
  `platform.payments.execute`, `platform.withdrawals.read`, `platform.withdrawals.execute`,
  `platform.commissions.execute`, `platform.communications.read`, and
  `platform.communications.manage`

Every production gate must include a real super admin session. Service-role-only checks are not
enough for milestone completion.

Driver and vehicle access:

- drivers cannot self-assign approval or become available before approval
- vehicle owners cannot self-activate vehicles
- active dispatch eligibility requires an approved driver, an active approved vehicle, an active
  driver-vehicle authorization link, and configured capability matches for both sides

Organization staff access:

- business owners receive organization-scoped roles through approved application activation
- organization staff access is granted through controlled invitations and acceptance
- custom organization roles cannot grant `platform.*` permissions
- branch-scoped role assignments are enforced by `has_permission_for_branch`
- suspension disables organization membership and assigned organization roles
- ownership transfer is controlled by RPC and leaves the organization with an active owner
- direct client inserts into memberships, user roles, branches, invitations, and staff events are
  rejected

Catalog and availability access:

- catalog management requires organization-scoped `business.catalog.manage`
- branch-scoped staff can manage catalog records only for their assigned branch
- organization-level catalog records require unscoped organization authority or platform
  configuration/admin authority
- authenticated users can read active catalog, price, media, and availability records for
  orderability checks
- direct client writes to catalog runtime tables are rejected; mutations go through governed RPCs
- catalog runtime events are append-only

Order operations access:

- authenticated customers can create module-backed orders for active partner organizations from
  orderable catalog items
- customers can read and complete their own orders where the configured workflow permits it
- business order processing requires `business.orders.process`, `business.orders.manage`, platform
  runtime permission, or organization ownership
- branch-scoped staff can process only orders in their assigned branch
- direct client writes to order runtime tables are rejected; mutations go through governed RPCs
- order events are append-only

Remaining hardening:

- business-owner, business-admin, branch-manager, finance-manager, support, driver, customer, and
  read-only auditor role templates
- finance-sensitive permissions that cannot be granted by ordinary business staff
- expiry, suspension/reactivation, fleet assignment, and ownership transfer authorization gates
- additional tests proving users cannot cross organization boundaries

Hosted finance/communication gates prove that normal users can request their own wallet deposit,
withdrawal, communication, and OTP operations, while privileged execution paths require platform
finance/communication authority or service/worker context.
