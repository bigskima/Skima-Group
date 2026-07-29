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
- NGN deposit ledger posting into customer wallets
- withdrawal reserve, transfer success, failed-transfer reversal, and ledger receipts
- order funding from customer wallet into escrow
- driver commission credit from escrow
- business settlement credit and platform fee split from escrow
- settlement-clearing wallet provisioning
- reconciliation including order totals, quote totals, wallet balances, and ledger postings

Hosted evidence:

- `npm run supabase:finance-communication:e2e` proves the deposit, withdrawal, escrow, commission,
  settlement, and reconciliation path against hosted Supabase.
- Remote gates still keep incomplete-operation and append-only mutation checks active.

Remaining production-launch work:

- live payment/transfer provider certification
- broader refund, dispute, partial-release, and expiry edge-case gates
- scheduled worker evidence for expirations
