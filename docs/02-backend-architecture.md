# Backend Architecture

Backend execution must be testable without UI.

Current backend surfaces:

- `health`: public health function.
- `api-gateway`: authenticated API and runtime gateway.
- `runtime-worker`: worker-secret protected notification, AI, webhook delivery, job, expiry, and
  health processor.
- `payment-webhook`: provider-secret protected payment event intake.
- `webhook-sandbox-receiver`: signed sandbox receiver used to prove outbound webhook delivery in
  hosted backend gates.
- structured gateway validation and database-backed rate limiting.

Database runtime functions remain the transaction boundary for wallets, financial postings, workflow
advancement, module configuration, and reusable engine state changes.
