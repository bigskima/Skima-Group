# Database Schema

Primary schema objects live in `supabase/migrations`.

Implemented groups:

- identity, organizations, roles, permissions, admins
- engine definitions and runtime receipts
- wallets, financial transactions, ledger entries, escrow holds
- workflow definitions, instances, and transition receipts
- business module registry, versions, components, and events
- LPG module configuration records
- module-backed `service_requests`
- immutable `service_request_events`
- executable `price_quotes`
- `settlement_executions`
- `provider_execution_logs`
- `webhook_delivery_attempts`
- webhook delivery retry, locking, and dead-letter metadata on `webhook_deliveries`
- endpoint-level webhook retry/dead-letter policy overrides
- private Supabase Storage bucket configuration for platform documents and media
- configurable document requirement sets and document requirements
- workflow-governed `application_records`, immutable application events, review tasks, and review
  events
- governed `document_submissions` and immutable document review events
- driver profile application hydration fields and approval timestamp
- structured vehicle specification fields, ownership type, and vehicle document-backed activation
- `driver_vehicle_links` for approved driver-to-vehicle authorization
- dispatch policy rules for separate driver-required and vehicle-required capabilities
- `organization_branches` for branch-scoped business operations
- `organization_invitations` for governed staff invitation and acceptance
- `organization_staff_events` for append-only staff, branch, role, and ownership receipts
- branch-scoped `user_roles.access_scope` and `user_roles.branch_id`
- reusable catalog records: `catalog_units`, `catalog_categories`, `catalog_items`,
  `catalog_item_variants`, `catalog_prices`, `catalog_item_media`, and `catalog_availability_rules`
- stock/capacity and orderability runtime records: `catalog_stock_adjustments`,
  `catalog_orderability_checks`, and append-only `catalog_runtime_events`
- reusable order runtime records: `order_acceptance_policies`, `order_action_definitions`,
  `order_records`, `order_line_items`, `order_assignments`, and append-only `order_events`
- finance and communication runtime records: `payment_deposit_requests`, `payment_webhook_events`,
  `withdrawal_beneficiaries`, `withdrawal_requests`, `transfer_executions`, `withdrawal_events`,
  `commission_policies`, `commission_executions`, `settlement_accounts`, `settlement_statements`,
  `communication_messages`, `communication_events`, `otp_challenges`, and `otp_attempts`

Remote migration evidence for `20260728050000_webhook_delivery_runtime.sql` has been recorded
against the hosted Supabase dev project. Remote migration evidence for
`20260728060000_webhook_retry_policy_override.sql` has been recorded against the hosted Supabase dev
project. Remote migration evidence for `20260728070000_application_document_runtime.sql` has also
been recorded against the hosted Supabase dev project. Remote migration evidence for
`20260728080000_driver_vehicle_onboarding_runtime.sql`,
`20260728090000_lpg_dispatch_vehicle_capability_binding.sql`, and
`20260728100000_application_activation_capability_variable_fix.sql` has also been recorded against
the hosted Supabase dev project. Remote migration evidence for
`20260728110000_organization_staff_runtime.sql` and
`20260728120000_organization_role_variable_fix.sql` has also been recorded against the hosted
Supabase dev project. Remote migration evidence for
`20260728130000_catalog_availability_runtime.sql` has also been recorded against the hosted Supabase
dev project. Remote migration evidence for `20260728140000_order_operations_runtime.sql` has also
been recorded against the hosted Supabase dev project. Remote migration evidence for
`20260728150000_finance_communication_runtime.sql`,
`20260728160000_finance_runtime_variable_fix.sql`,
`20260728170000_payment_webhook_append_only_fix.sql`,
`20260728180000_withdrawal_beneficiary_crypto_fix.sql`, and
`20260728190000_otp_crypto_schema_fix.sql` has also been recorded against the hosted Supabase dev
project. `20260728200000_live_provider_adapter_catalog.sql` adds live adapter catalog records for
Paystack, Monnify, Flutterwave, Resend, and Twilio.
`20260728210000_pause_live_communication_providers.sql` marks Resend and Twilio disabled until
communication delivery is resumed. `20260728220000_paystack_webhook_and_in_app_otp_runtime.sql`
activates the Paystack NGN adapter, requires verified payment webhook events, adds protected
`otp_delivery_codes` and append-only `otp_delivery_code_accesses`, and exposes owner-only in-app OTP
delivery through `fetch_in_app_otp_code`.

Backend-domain remediation gaps:

- document expiry worker and quarantine scanning provider execution
- driver and vehicle expiry, suspension/reactivation, fleet assignment, ownership transfer, and
  broader dispatch edge-case coverage
- Paystack account/webhook/payout certification before real public money is enabled
- live email, SMS, WhatsApp, AI, and maps provider certification outside sandbox adapters
- production backup/PITR and external alerting evidence

These gaps are tracked in `docs/26-backend-domain-audit.md`.
