# Reusable Engine Architecture

Milestone 2 turns the platform foundation into reusable engines. Engines are database-backed,
policy-controlled, event-ready, and provider-adapter aware.

## Rules

- Engines are business-agnostic.
- Engine behavior is stored as policy, configuration, workflow, or event records.
- Providers are referenced through `provider_adapters`.
- Money movement is ledger-based.
- AI assists through task records and provider adapters. AI does not control platform state.

## Currency

`currency_definitions` controls supported currencies. Phase One enables only `NGN`.

Future currencies are enabled by configuration and database records, not backend code changes.

## Financial Movement

Financial movement flows through:

- `financial_transactions`
- `wallet_accounts`
- `wallet_ledger_entries`
- `wallet_balances`
- `escrow_holds`
- `settlement_policies`

Wallet balances are derived from append-only ledger entries.

Wallet accounts are provisioned through `ensure_wallet_account`; status changes go through
`set_wallet_account_status`. Wallet account events are append-only, and authenticated clients cannot
insert or update wallet accounts directly.

Runtime money movement must go through `post_financial_transaction`. The function requires an
idempotency key, validates enabled currency records, verifies all wallets are active in the same
currency, requires debit and credit totals to balance, and inserts the transaction plus ledger rows
as one database operation.

Authenticated clients cannot insert `financial_transactions` or `wallet_ledger_entries` directly.
Platform admins with financial authority call the engine function; deployment automation keeps
service-role access for controlled operations.

`verify_wallet_ledger_append_only` validates ledger update/delete blocking inside a rolled-back
database block using the real platform wallets, so the production gate leaves no verification
balances behind.

## Operational Engines

Dispatch, tracking, verification, notifications, maps, and AI are generic engine records. Business
modules later configure these engines through policies, workflow definitions, event handlers, and
provider adapters.

## Workflow And Events

Workflow definitions, versions, states, and transitions remain configuration records. Runtime
changes go through:

- `record_platform_event`
- `start_workflow_instance`
- `advance_workflow_instance`
- `workflow_instance_events`

The runtime requires idempotency keys, checks active event and workflow definitions, starts from the
configured initial state, advances only through configured transitions, and records each transition
as an immutable workflow runtime receipt.

Authenticated clients cannot insert `event_log`, `workflow_instances`, or `workflow_instance_events`
directly. Guarded transitions are blocked until policy evaluation is available, so a configured
guard cannot be accidentally skipped.

## Operational Runtime

Dispatch, tracking, verification, notifications, AI, and map requests use runtime RPCs instead of
direct table writes:

- `record_verification_event`
- `create_dispatch_request`
- `upsert_dispatch_candidate`
- `assign_dispatch_request`
- `start_tracking_session`
- `record_tracking_point`
- `update_tracking_session_status`
- `queue_notification_message`
- `update_notification_message_status`
- `queue_ai_task_run`
- `update_ai_task_run_status`
- `queue_map_service_request`

Each runtime command requires an idempotency key. Dispatch, tracking, notification, and AI status
changes write receipt rows, and those receipt rows are append-only.

Authenticated clients cannot directly insert runtime rows for verification events, dispatch
requests/candidates, tracking sessions/points, notification messages, AI task runs, or map service
requests. Runtime state changes must go through the engine functions, where provider adapters,
active definitions, JSON payload shape, and status transitions are validated.
