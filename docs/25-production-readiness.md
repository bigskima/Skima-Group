# Production Readiness

Production readiness requires:

- implementation exists
- reusable/business-agnostic design verified
- migrations apply remotely
- RLS and permissions enforced
- input validation and controlled errors
- idempotency for retryable operations
- immutable audit and ledger records
- automated tests pass
- security checks pass
- documentation updated
- reviewer approval recorded

Current status:

- Milestone 4 frontend work is paused until reviewer approval is recorded.
- Milestones 1-3 backend implementation is complete for the hosted Supabase development gate and is
  pending reviewer approval.
- Production launch still requires paid-plan operations hardening for PITR/backups and log-drain
  alerting.
- `health`, `api-gateway`, `runtime-worker`, `payment-webhook`, and `webhook-sandbox-receiver` are
  deployed to hosted Supabase.
- `npm run supabase:remote:gate` passed with real platform super-admin credentials after the finance
  and communication runtime was deployed.
- `npm run supabase:applications:e2e` passed with application
  `227a747e-e0c6-4a1b-bde6-5d6fff4948e3`, organization `a0a0552f-5393-4a54-9bff-2709f59163fa`, and
  partner `490b9529-458e-4a7b-a95d-384752d8aab1`.
- `npm run supabase:drivers:e2e` passed with driver application
  `40801c03-3f61-4f05-8f7a-66261b8e2824`, vehicle application
  `df973764-8562-4533-8d12-b0593643e890`, driver `7ba7b9dc-a1b1-4ca7-92fc-8bcaf6b148b4`, and vehicle
  `d6904601-dc97-4de2-81fb-5a0d61fe20d3`.
- `npm run supabase:staff:e2e` passed with organization `9a353ea3-9554-49b6-bae7-b8122347c552`,
  branch `f01ba9a9-2575-4469-9dba-4c875b482013`, staff user `a39157d8-2017-459e-83b6-5d6612f22e2d`,
  and invitation `138c4ec8-823c-4947-8c9e-051a97bf0a52`.
- `npm run supabase:catalog:e2e` passed with organization `1b3ac8a4-a422-4c18-aee5-2d6d86d29f07`,
  branch `5e635b70-e2b0-4717-8ebc-8a43b71b7847`, item `2987406e-98c7-4e8e-80a9-227bfe155ef3`,
  variant `e76aa7e8-59f3-40c7-bf8a-9ef26c3b34b7`, availability rule
  `013b748e-6a51-4fd6-b01f-4cacd56b9ac8`, and orderability check
  `a11caa1b-2b6d-46af-9799-c85cfe3280a3`.
- `npm run supabase:orders:e2e` passed with order `575e4331-7cff-4bae-b8e1-0502bda9e5d0`, service
  request `0436d226-fb20-4dc4-b4e2-8609a8cd05fd`, organization
  `29b703f1-b92b-4608-a9fd-8603cba142b5`, branch `cb6d46a7-2388-403c-a323-905e6a4128bc`, item
  `9b719c0d-e6c4-4a37-b7eb-d72e5655c6d0`, variant `05179dd1-c5cb-40a0-b8d3-d84cabcc03f7`, and
  availability rule `080ac5b1-be6b-417e-bc1a-f3b61e92460a`.
- `npm run supabase:backend:e2e` passed with service request `5f0c5ffa-2063-41fd-babb-56a88e0856f0`.
- `npm run supabase:webhook:dead-letter` passed with webhook delivery
  `77694e51-b988-460a-a9fd-3d451a6799fa`.
- `npm run supabase:finance-communication:e2e` passed with deposit
  `38d84d40-18e4-46f1-95a1-f382d9b1d85e`, withdrawal `cc95947f-2784-459f-bb2e-22c73c4deeb3`,
  communication message `92f5dc5f-080c-4488-bb65-2d8d9853ef0b`, OTP challenge
  `f23e8bd1-d215-445a-89e9-598242944b19`, order `a80de045-ee24-4e03-bd79-11898c9fe385`, escrow hold
  `9ebc8534-d74b-441e-8497-225209cf6147`, commission execution
  `90918e73-3399-4ade-a13d-f3b6a1790e0c`, and settlement statement
  `de906498-8f76-4954-b5a6-2490c9d6f25a`.
- Backend-domain audit is recorded in `docs/26-backend-domain-audit.md`.

Current blockers before public production launch:

- Reviewer approval for Milestones 1-3 evidence is still pending.
- Live NGN provider credentials and adapter certification are still required before real customer
  money is enabled. The current gate uses the deterministic sandbox payment adapter.
- Live email, SMS, WhatsApp, AI, and maps provider certification is still required before those
  vendors are enabled outside the sandbox.
- Supabase Free-plan PITR and Log Drains are unavailable and must be replaced by a production
  operations plan before launch.
