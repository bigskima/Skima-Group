# Financial Engine

Money movement must enter the platform financial gateway before distribution.

Implemented:

- `post_financial_transaction`
- balanced debit/credit validation
- enabled currency validation
- append-only ledger integration
- service request payment reservation through `create_escrow_hold`
- service request settlement through `execute_service_request_settlement`
- reconciliation through `reconcile_service_request_financials`
- payment webhook intake through `supabase/functions/payment-webhook`

Required remediation:

- remote migration and function deployment evidence
- E2E proof of escrow, release, platform fee, commission, and final balances
- live provider adapter certification before production payment vendors are enabled
