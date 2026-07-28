# Testing Strategy

Required test layers:

- static verification with `npm run verify`
- hosted migration with `npm run supabase:db:push`
- Edge Function deployment with `npm run supabase:functions:deploy`
- remote hosted Supabase gate with real admin session
- no-frontend lifecycle gate with `npm run supabase:backend:e2e`
- database integration tests for every runtime RPC
- Edge Function API tests
- worker and webhook tests
- signed outbound webhook delivery tests
- retry and dead-letter tests
- hosted dead-letter gate with `npm run supabase:webhook:dead-letter`
- no-frontend E2E lifecycle test
- security/RLS tests for anon, users, admins, and service role

Mocks are allowed only as sandbox provider implementations. Production interfaces and execution
paths must be real.
