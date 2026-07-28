# Deployment Operations

Hosted Supabase dev is the runtime gate.

Required command sequence:

- `npm run verify`
- `npm run supabase:db:push`
- `npm run supabase:functions:deploy`
- `npm run supabase:remote:gate`
- `npm run supabase:backend:e2e`

Required operational evidence:

- Supabase runtime secrets configured
- `SKIMA_WORKER_SECRET` configured with `supabase secrets set`
- `SKIMA_PAYMENT_WEBHOOK_SECRET` configured with `supabase secrets set`
- health/readiness pass
- monitoring alerts configured
- backup/PITR reviewed before production
- remote gates run with a real platform super admin session
