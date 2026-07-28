# API App

Skima's API surface is implemented through Supabase Edge Functions.

Current foundation functions:

- `supabase/functions/health`
- `supabase/functions/api-gateway`
- `supabase/functions/runtime-worker`
- `supabase/functions/payment-webhook`

Business modules must not add business logic here. They register workflows, events, policies, and
module configuration that the platform engines execute.

The gateway is intentionally the main authenticated HTTP entrypoint while platform behavior lives in
Postgres RPCs, RLS, and configuration. Worker-secret and provider-secret functions own separate
runtime boundaries for background processing and webhook intake.
