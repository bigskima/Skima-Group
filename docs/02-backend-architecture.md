# Backend Architecture

Backend execution must be testable without UI.

Current backend surfaces:

- `health`: public health function.
- `api-gateway`: authenticated API and runtime gateway.
- `runtime-worker`: worker-secret protected notification, AI, webhook delivery, job, expiry, and
  health processor.
- `payment-webhook`: provider-secret protected payment event intake.
- `webhook-sandbox-receiver`: signed sandbox receiver used to prove outbound webhook delivery in
  hosted backend gates.
- structured gateway validation and database-backed rate limiting.

Database runtime functions remain the transaction boundary for wallets, financial postings, workflow
advancement, module configuration, and reusable engine state changes.

New local remediation surface:

- Application and Document Runtime migration:
  `supabase/migrations/20260728070000_application_document_runtime.sql`
- Application/document routes through `api-gateway`: application type discovery, application draft,
  payload update, submit, reviewer assignment, correction request, review decision, withdrawal,
  document requirement listing, document registration, and document review
- No-frontend hosted gate script: `scripts/verify-application-document-lifecycle.ts`
- Driver and Vehicle Onboarding Runtime migration:
  `supabase/migrations/20260728080000_driver_vehicle_onboarding_runtime.sql`
- Driver/vehicle read routes through `api-gateway`: driver profiles, vehicles, and active
  driver-vehicle authorization links
- No-frontend hosted driver/vehicle gate script: `scripts/verify-driver-vehicle-onboarding.ts`
- Organization Staff Runtime migration:
  `supabase/migrations/20260728110000_organization_staff_runtime.sql`
- Organization staff RPC repair migration:
  `supabase/migrations/20260728120000_organization_role_variable_fix.sql`
- Organization staff routes through `api-gateway`: branches, organization roles, memberships,
  assigned organization roles, invitations, invitation acceptance, staff status changes, ownership
  transfer, and staff event history
- No-frontend hosted organization staff gate script:
  `scripts/verify-organization-staff-lifecycle.ts`
- Catalog and Availability Runtime migration:
  `supabase/migrations/20260728130000_catalog_availability_runtime.sql`
- Catalog/availability routes through `api-gateway`: units, categories, items, variants, prices,
  media links, availability rules, stock adjustments, and orderability checks
- No-frontend hosted catalog/availability gate script:
  `scripts/verify-catalog-availability-lifecycle.ts`
- Order Operations Runtime migration:
  `supabase/migrations/20260728140000_order_operations_runtime.sql`
- Order routes through `api-gateway`: order action discovery, acceptance policies, order creation
  from catalog, line-item reads, guarded order actions, participant assignment, and order event
  history
- No-frontend hosted order operations gate script: `scripts/verify-order-operations-lifecycle.ts`
- Finance and Communication Runtime migration:
  `supabase/migrations/20260728150000_finance_communication_runtime.sql`
- Finance corrective migrations:
  `supabase/migrations/20260728160000_finance_runtime_variable_fix.sql`,
  `supabase/migrations/20260728170000_payment_webhook_append_only_fix.sql`,
  `supabase/migrations/20260728180000_withdrawal_beneficiary_crypto_fix.sql`, and
  `supabase/migrations/20260728190000_otp_crypto_schema_fix.sql`
- Finance/communication routes through `api-gateway`: deposits, deposit verification, wallets,
  balances, beneficiaries, withdrawals, transfer execution, order funding, commission execution,
  business settlement statements, communication queueing, delivery sync, OTP request, and OTP
  verification
- Signed deposit processing through `payment-webhook`
- No-frontend hosted finance/communication gate script:
  `scripts/verify-finance-communication-lifecycle.ts`

Milestones 1-3 were reviewer-approved on 2026-07-30. The backend architecture now includes the
requested production-domain runtime surfaces for hosted development gates:

- NGN payment, deposit, withdrawal, transfer, reconciliation, commission, and settlement execution
  through provider adapters
- Communication and OTP Engine for email, SMS, WhatsApp, and in-app channels

Each domain must expose authenticated API routes or worker surfaces, enforce backend permissions,
write audit/runtime receipts, and pass no-frontend integration gates. Live vendor enablement is
handled by provider adapter configuration and Supabase secrets.
