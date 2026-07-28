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
- `SKIMA_OUTBOUND_WEBHOOK_SANDBOX_SECRET` configured with `supabase secrets set` before running the
  no-frontend lifecycle gate against the sandbox outbound webhook receiver
- AI provider secrets such as `GEMINI_API_KEY` configured only when enabling a live AI provider
- Map provider secrets such as `GOOGLE_MAPS_API_KEY`, `MAPBOX_ACCESS_TOKEN`, or `HERE_API_KEY`
  configured only when enabling a live maps provider
- health/readiness pass
- monitoring alerts configured
- backup/PITR reviewed before production
- remote gates run with a real platform super admin session
