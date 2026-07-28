# Pricing Engine

Pricing policies are database records.

Implemented:

- `calculate_price_quote`
- `accept_price_quote`
- `price_quotes` with idempotency, policy snapshots, expiration, and accepted quote state
- configured fixed, distance, weight, time, hybrid, dynamic, subscription, marketplace, manual,
  negotiated, quoted, and AI-assisted calculation paths

Required remediation:

- API route and integration tests for valid calculation, invalid currency, unknown policy, and
  idempotency
- remote E2E proof using LPG as module configuration only
