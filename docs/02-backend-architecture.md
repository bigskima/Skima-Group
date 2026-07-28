# Backend Architecture

Backend execution must be testable without UI.

Current backend surfaces:

- `health`: public health function.
- `api-gateway`: authenticated API and runtime gateway.
- `runtime-worker`: worker-secret protected notification, AI, job, expiry, and health processor.
- `payment-webhook`: provider-secret protected payment event intake.
- structured gateway validation and database-backed rate limiting.

Database runtime functions remain the transaction boundary for wallets, financial postings, workflow
advancement, module configuration, and reusable engine state changes.
