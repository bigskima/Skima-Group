# API App

Skima's API surface is implemented through Supabase Edge Functions.

Current foundation functions:

- `supabase/functions/health`
- `supabase/functions/api-gateway`

Business modules must not add business logic here. They register workflows, events, policies, and
module configuration that the platform engines execute.
