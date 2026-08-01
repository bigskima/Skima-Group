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
- Paystack backend transaction initialization through the authenticated `/runtime/payments/deposits`
  route when `providerAdapterKey` is `provider.payment.paystack`
- NGN wallet deposit initialization through `initialize_wallet_deposit`
- Paystack `x-paystack-signature` HMAC-SHA512 verification, sandbox secret verification, signed
  deposit webhook processing, and duplicate protection through
  `process_wallet_deposit_provider_event`
- explicit deposit verification through `verify_wallet_deposit`
- withdrawal beneficiary verification through `configure_withdrawal_beneficiary`
- withdrawal request, approval, transfer success, failure, and reversal through
  `request_wallet_withdrawal`, `approve_wallet_withdrawal`, and `process_wallet_withdrawal_transfer`
- order wallet funding into escrow through `fund_order_from_wallet`
- driver commission execution through `execute_driver_commission`
- business settlement statement execution through `execute_order_business_settlement`

Hosted evidence:

- `npm run supabase:finance-communication:e2e` proves deposit, webhook duplicate protection,
  withdrawal success/failure, escrow funding, driver commission, business settlement, final wallet
  balances, and reconciliation.
- Paystack Dashboard account/webhook verification and payout certification remain required before
  real customer money is enabled.
