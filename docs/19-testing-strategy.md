# Testing Strategy

Required test layers:

- static verification with `npm run verify`
- hosted migration with `npm run supabase:db:push`
- Edge Function deployment with `npm run supabase:functions:deploy`
- remote hosted Supabase gate with real admin session
- no-frontend lifecycle gate with `npm run supabase:backend:e2e`
- database integration tests for every runtime RPC
- Edge Function API tests
- worker and webhook tests
- signed outbound webhook delivery tests
- retry and dead-letter tests
- hosted dead-letter gate with `npm run supabase:webhook:dead-letter`
- application/document onboarding gate with `npm run supabase:applications:e2e`
- driver and vehicle onboarding/dispatch eligibility gate with `npm run supabase:drivers:e2e`
- organization staff, branch permission, and ownership transfer gate with
  `npm run supabase:staff:e2e`
- catalog, availability, stock/capacity, and orderability gate with `npm run supabase:catalog:e2e`
- order receiving, branch-scoped processing, workflow, stock reservation/consumption, events, audit,
  and notification gate with `npm run supabase:orders:e2e`
- no-frontend E2E lifecycle test
- security/RLS tests for anon, users, admins, and service role
- business onboarding E2E test: hosted proof exists through
  `scripts/verify-application-document-lifecycle.ts`
- driver and vehicle onboarding E2E test: hosted proof exists through
  `scripts/verify-driver-vehicle-onboarding.ts`
- business staff and branch permission E2E test: hosted proof exists through
  `scripts/verify-organization-staff-lifecycle.ts`
- catalog and availability E2E test: hosted proof exists through
  `scripts/verify-catalog-availability-lifecycle.ts`
- order-processing E2E test: hosted proof exists through
  `scripts/verify-order-operations-lifecycle.ts`
- finance and communication E2E test: hosted proof exists through
  `scripts/verify-finance-communication-lifecycle.ts`
- NGN deposit, webhook, duplicate protection, ledger, and reconciliation E2E test
- withdrawal, transfer, failure, reversal, and reconciliation E2E test
- commission and settlement duplicate-prevention E2E test
- email, SMS, WhatsApp, in-app, and OTP E2E test

Mocks are allowed only as sandbox provider implementations. Production interfaces and execution
paths must be real.
