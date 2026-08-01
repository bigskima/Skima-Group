# Provider Adapters

Provider adapters isolate replaceable external systems.

Skima does not rebuild external platforms that already exist. AI reasoning, map rendering, GPS,
routing, traffic, and payment processing are provided by specialized vendors behind adapters. Skima
owns orchestration, configuration, security, audit, workflow, policy, and business decisions.

Implemented:

- provider adapter records
- shared TypeScript provider registry contract
- deterministic sandbox adapters for payment, notification, maps, AI, queue, cache, and
  observability
- Supabase Storage adapter catalog record for private platform document/media buckets
- configurable provider catalog records for Gemini, OpenAI, Anthropic Claude, Google Maps, Mapbox,
  HERE, and OpenStreetMap
- `provider_execution_logs`
- Paystack `x-paystack-signature` HMAC-SHA512 webhook validation plus sandbox webhook secret
  validation
- worker secret validation
- server-side secret references in provider records
- outbound webhook delivery through the `provider.queue.webhook-delivery` adapter
- signed sandbox webhook receiver for hosted delivery gates
- endpoint-level webhook retry/dead-letter policy overrides for controlled operations and tests
- sandbox payment adapter capabilities for initialize, verify, webhook, beneficiary resolution,
  recipient creation, transfer initiation, and transfer verification
- sandbox communication adapter capabilities for queued email, SMS, WhatsApp, and in-app delivery
- finance and communication provider execution logs included in hosted E2E gates
- active Paystack NGN adapter record with backend transaction initialization
- inactive live payment adapter catalog records for Monnify and Flutterwave
- disabled live communication adapter catalog records for Resend and Twilio

Required before public production launch:

- live vendor adapter certification before production vendors are enabled
- `npm run supabase:webhook:dead-letter` evidence on hosted Supabase
- Paystack account verification, `PAYSTACK_SECRET_KEY`/`PAYSTACK_PUBLIC_KEY` Supabase secrets,
  Dashboard webhook URL configuration, and payout certification before real customer money is
  enabled
- email, SMS, and WhatsApp provider credentials and template certification before disabled live
  channels are re-enabled
- live map and Gemini adapters must remain replaceable through configuration and must never be
  called directly by business modules

Business modules must never call vendor APIs directly.

Credential collection and activation steps are documented in
`docs/runbooks/provider-credential-activation.md`.
