# Deployment Operations

Hosted Supabase dev is the runtime gate.

Local deployment scripts load `.env` and `.env.local` when present. These files are gitignored and
are only for operator verification values such as `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`,
`SKIMA_WORKER_SECRET`, and the real admin gate credentials. Browser/mobile apps must still receive
only client-safe Supabase values.

Required command sequence:

- `npm run verify`
- `npm run supabase:db:push`
- `npm run supabase:functions:deploy`
- `npm run supabase:remote:gate`
- `npm run supabase:backend:e2e`
- `npm run supabase:webhook:dead-letter`
- `npm run supabase:applications:e2e`
- `npm run supabase:drivers:e2e`
- `npm run supabase:staff:e2e`
- `npm run supabase:catalog:e2e`
- `npm run supabase:orders:e2e`
- `npm run supabase:finance-communication:e2e`

Milestones 1-3 were approved on 2026-07-30 after these hosted gates passed. Milestone 4 reusable
frontend foundation work is unblocked. Live provider certification is handled as production launch
hardening.

Required operational evidence:

- Supabase runtime secrets configured
- `SKIMA_WORKER_SECRET` configured with `supabase secrets set`
- `SKIMA_PAYMENT_WEBHOOK_SECRET` configured with `supabase secrets set`
- `PAYSTACK_SECRET_KEY` configured with `supabase secrets set` before Paystack webhook signature
  gates can pass
- `PAYSTACK_PUBLIC_KEY` configured with `supabase secrets set` for Paystack provider records and
  future client-safe payment metadata
- `SKIMA_OUTBOUND_WEBHOOK_SANDBOX_SECRET` configured with `supabase secrets set` before running the
  no-frontend lifecycle gate against the sandbox outbound webhook receiver
- AI provider secrets such as `GEMINI_API_KEY` configured only when enabling a live AI provider
- Map provider secrets such as `GOOGLE_MAPS_API_KEY`, `MAPBOX_ACCESS_TOKEN`, or `HERE_API_KEY`
  configured only when enabling a live maps provider
- health/readiness pass
- monitoring alerts configured
- backup/PITR reviewed before production
- remote gates run with a real platform super admin session
- Supabase Storage buckets and policies reviewed before document uploads are enabled
- provider-specific NGN payment credentials configured only as Supabase secrets
- Paystack Dashboard webhook URL set to
  `https://npgladvhpidkgpyzdwxf.supabase.co/functions/v1/payment-webhook`
- communication provider credentials configured only as Supabase secrets
- OTP secrets, expiry policy, and rate limits configured before production use
- provider credentials collected and activated according to
  `docs/runbooks/provider-credential-activation.md`
- Resend and Twilio remain disabled until production communication delivery is explicitly resumed.
- Current OTP mode is backend-generated, owner-fetched through authenticated in-app delivery, and
  backend-verified. The frontend is never the OTP authority.

Hosted dev evidence as of the Paystack/OTP remediation:

- remote gate passed after deploying `20260728150000` through `20260728220000`
- invalid Paystack signature rejection passed in `npm run supabase:remote:gate`
- full no-frontend backend lifecycle passed
- application/document, driver/vehicle, staff, catalog, order, webhook dead-letter, and
  finance/communication E2E gates passed
