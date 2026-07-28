# Wallet Ledger And Escrow

Wallet balances are derived from immutable ledger entries.

Implemented:

- `ensure_wallet_account`
- `set_wallet_account_status`
- `wallet_balances`
- `verify_wallet_ledger_append_only`
- `create_escrow_hold`
- `update_escrow_hold_status`
- `release_escrow_hold`
- `refund_escrow_hold`
- `expire_escrow_holds`
- `settlement_executions` receipts linked to ledger transactions

Required remediation:

- reconciliation evidence after an end-to-end lifecycle
- remote gate evidence for refund, dispute, expiry, and release failure paths
- scheduled worker evidence for expirations
