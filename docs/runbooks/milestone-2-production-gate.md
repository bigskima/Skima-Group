# Milestone 2 Production Gate

Milestone 3 may not start until this checklist is complete.

Current status: Complete.

## Scope

Milestone 2 builds reusable platform engines only. It must not add business modules, LPG flows, or
business-specific screens.

## Local Verification

- [x] Shared TypeScript contracts compile with Deno.
- [x] Static validation confirms all engine tables have RLS.
- [x] Static validation confirms wallet ledger entries are append-only.
- [x] Static validation confirms NGN is the Phase One enabled currency.
- [x] Static validation confirms provider-dependent engines reference provider adapters.
- [x] Static validation confirms wallet accounts are provisioned and statused through database
      engines.
- [x] Static validation confirms direct authenticated wallet account mutation is rejected by RLS.
- [x] Static validation confirms wallet account events are append-only.
- [x] Static validation confirms financial posting goes through a balanced idempotent database
      engine.
- [x] Static validation confirms direct authenticated financial transaction and ledger inserts are
      rejected by RLS.
- [x] Static validation confirms workflow/event runtime changes go through idempotent database
      engines.
- [x] Static validation confirms direct authenticated event and workflow runtime inserts are
      rejected by RLS.
- [x] Static validation confirms operational runtime commands go through idempotent database
      engines.
- [x] Static validation confirms operational runtime receipt records are append-only.
- [x] Static validation confirms direct authenticated operational runtime inserts are rejected by
      RLS.

## Remote Supabase Verification

- [x] Engine remediation migration applies to the hosted Supabase dev project.
- [x] Remote gate confirms service-role access to reusable engine tables.
- [x] Remote gate confirms anonymous users cannot read protected engine routes and tables.
- [x] Remote gate confirms the platform super admin can read governed engine records.
- [x] Remote gate confirms real platform-owned NGN wallets exist.
- [x] Remote gate confirms incomplete wallet runtime operations are rejected by the wallet engines.
- [x] Remote gate confirms wallet ledger direct update/delete attempts fail without persisting
      verification ledger entries.
- [x] Remote gate confirms incomplete financial postings are rejected by the posting engine.
- [x] Remote gate confirms incomplete workflow/event runtime operations are rejected by the runtime
      engines.
- [x] Remote gate confirms executable pricing, escrow, settlement, provider workers, outbound
      webhooks, retry/dead letter processing, and reconciliation reject incomplete operations after
      webhook delivery runtime is pushed.
- [x] Full no-frontend lifecycle proves successful runtime execution across all engines after the
      webhook-aware lifecycle gate is deployed.

## Engine Checklist

- [x] Workflow runtime instances
- [x] Workflow runtime transition receipts
- [x] Event handlers
- [x] Verification definitions and events
- [x] Verification event runtime function
- [x] Pricing policies
- [x] Settlement policies
- [x] Wallet accounts and ledger entries
- [x] Wallet account provisioning and status runtime functions
- [x] Wallet account runtime receipts
- [x] Financial transactions
- [x] Balanced idempotent financial posting function
- [x] Currency definitions with NGN active
- [x] Payment provider adapters through provider configuration
- [x] Escrow holds
- [x] Dispatch policies and requests
- [x] Dispatch request, candidate, and assignment runtime functions
- [x] Dispatch runtime receipts
- [x] Tracking sessions and points
- [x] Tracking session and point runtime functions
- [x] Tracking runtime receipts
- [x] Maps adapter request records
- [x] Maps request runtime function
- [x] Notification templates and messages
- [x] Notification queue and status runtime functions
- [x] Notification runtime receipts
- [x] AI task definitions and runs
- [x] AI task queue and status runtime functions
- [x] AI runtime receipts
- [x] Executable pricing calculation
- [x] Escrow hold/release/refund/dispute/expiry execution
- [x] Settlement distribution execution
- [x] Provider worker execution
- [x] Outbound webhook delivery execution
- [x] Hosted non-2xx retry and dead-letter execution evidence with
      `npm run supabase:webhook:dead-letter`
- [x] Financial reconciliation execution
- [x] Hosted Supabase migration/deploy evidence for webhook delivery runtime
- [x] Hosted Supabase successful lifecycle evidence for webhook-aware runtime engines
- [ ] Reviewer approves runtime engine evidence.
