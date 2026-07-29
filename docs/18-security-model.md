# Security Model

Security requirements:

- Supabase Auth for all non-public APIs.
- RLS on every platform table.
- Service-role functions restricted to deployment or worker contexts.
- No privileged values in client env.
- Append-only audit and ledger records.
- Structured request validation and controlled errors.
- Worker and webhook functions require dedicated server-side secrets.
- Authenticated gateway routes enforce database-configured rate limits.
- Runtime service request, quote, settlement, and provider log mutations are routed through RPCs,
  not direct client table writes.
- Outbound webhook payloads are signed with HMAC SHA-256 using Supabase secret references.
- Webhook attempt records are append-only and inspectable only by webhook-governance admins.
- Application and document records reject direct client mutation and require governed RPCs.
- Private document/media Storage buckets restrict object access to owner-scoped paths or
  document-review/admin permissions.
- Driver profile approval cannot be self-assigned, and drivers cannot become available until
  approved.
- Vehicle owners cannot self-activate vehicles.
- Dispatch eligibility requires an active approved driver-vehicle authorization link plus configured
  driver and vehicle capability matches.
- Organization staff mutations go through RPCs, not direct client table writes.
- Organization roles cannot grant platform permissions, and branch-scoped checks use
  `has_permission_for_branch`.
- Staff suspension disables organization membership and organization-scoped role assignments.
- Organization staff event records are append-only.
- Catalog and availability mutations go through RPCs, not direct client table writes.
- Branch-scoped catalog management is enforced with `has_permission_for_branch`.
- Catalog orderability checks are idempotent and reject inactive items, inactive prices, unavailable
  records, insufficient stock, capacity overflow, and quantity bounds.
- Catalog runtime event records are append-only.
- Order creation locks and rechecks availability before reserving stock or capacity.
- Order processing goes through configured action definitions and workflow transitions; direct
  client table writes are rejected.
- Customer actions are limited to the authenticated requester, while business actions require
  branch-scoped `business.orders.process` or stronger authority.
- Order events are append-only and linked to platform events and service request events.
- Payment deposit requests are wallet-owner readable and are executed through governed RPCs.
- Payment webhook events are append-only and require the signed `payment-webhook` surface or
  platform finance execution authority.
- Withdrawal beneficiaries, withdrawal requests, transfer executions, and withdrawal events are
  guarded by wallet ownership, organization finance permissions, platform finance permissions, and
  append-only event policies.
- Commission execution and business settlement statements require platform finance/settlement
  execution authority or service/worker context.
- Communication messages and OTP challenges are owner-readable; OTP attempts are append-only, OTP
  codes are hashed, and one-time-use verification enforces expiry, attempt limits, and purpose
  scoping.

Current remediation focus:

- expand RLS and integration tests by role
- prove worker, provider webhook, and sandbox outbound webhook negative-auth checks on hosted
  Supabase
- prove broader workflow-controlled rejection, suspension, reactivation, expiry, and ownership
  transfer paths on hosted Supabase
- add cross-organization negative gates for business staff operations
- add broader catalog negative gates for schedules, effective-date windows, and capacity edge cases
- add broader order negative gates for cancellation, rejection, dispute, timeout, and reassignment
  edge cases
- certify live payment, transfer, email, SMS, WhatsApp, maps, and AI providers before public
  production launch
