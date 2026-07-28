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

Remote migration evidence for the remediation schema is still pending.
