# Security Model

Security requirements:

- Supabase Auth for all non-public APIs.
- RLS on every platform table.
- Service-role functions restricted to deployment or worker contexts.
- No privileged values in client env.
- Append-only audit and ledger records.
- Structured request validation and controlled errors.
- Worker and webhook functions require dedicated server-side secrets.
- Authenticated gateway routes enforce database-configured rate limits.
- Runtime service request, quote, settlement, and provider log mutations are routed through RPCs,
  not direct client table writes.
- Outbound webhook payloads are signed with HMAC SHA-256 using Supabase secret references.
- Webhook attempt records are append-only and inspectable only by webhook-governance admins.

Current remediation focus:

- expand RLS and integration tests by role
- prove worker, provider webhook, and sandbox outbound webhook negative-auth checks on hosted
  Supabase
