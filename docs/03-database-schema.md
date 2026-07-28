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

Remote migration evidence for `20260728050000_webhook_delivery_runtime.sql` has been recorded
against the hosted Supabase dev project. Remote migration evidence for
`20260728060000_webhook_retry_policy_override.sql` has been recorded against the hosted Supabase dev
project.
