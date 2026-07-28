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

Current remediation focus:

- expand RLS and integration tests by role
- prove worker and webhook negative-auth checks on hosted Supabase
