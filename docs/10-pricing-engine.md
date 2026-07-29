# Pricing Engine

Pricing policies are database records.

Implemented:

- `calculate_price_quote`
- `accept_price_quote`
- `price_quotes` with idempotency, policy snapshots, expiration, and accepted quote state
- configured fixed, distance, weight, time, hybrid, dynamic, subscription, marketplace, manual,
  negotiated, quoted, and AI-assisted calculation paths
- authenticated API route coverage through `/runtime/pricing/quotes`
- hosted no-frontend backend lifecycle proof using LPG as module configuration only

Remaining hardening:

- broader invalid currency, unknown policy, expired quote, and idempotency edge-case gates
