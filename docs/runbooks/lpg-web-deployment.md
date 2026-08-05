# Skima LPG Web Deployment

The launch web deployment is the dedicated LPG mobile web application:

```text
apps/lpg-mobile
```

Build output is produced in `apps/lpg-mobile/dist/` by:

```bash
npm run lpg-mobile:build
```

## Vercel

The repository includes `vercel.json` configured for the LPG launch app.

Required production environment variables:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_API_GATEWAY_URL
```

Deploy with:

```bash
npm run lpg-mobile:deploy:vercel
```

The Vercel project should expose only client-safe Supabase values. Service-role keys, database
passwords, provider secrets, webhook secrets, and payment provider secret keys must remain in
Supabase Edge Function secrets, CI secrets, or operator-only local env files.

## Smoke Test After Deploy

1. Open the deployed URL.
2. Confirm the Skima LPG onboarding/login screen renders.
3. Sign in with a test LPG customer.
4. Confirm customer tabs render: Home, Cylinders, Orders, Wallet, Account.
5. Open an active LPG order and verify live tracking polls backend tracking points.
6. Sign in as an approved driver and confirm route actions can post `/lpg/driver-locations`.
7. Sign in as station staff and confirm station jobs, scans, actual kilograms, and settlement screens
   load from the backend.

