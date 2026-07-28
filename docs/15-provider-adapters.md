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
- configurable provider catalog records for Gemini, OpenAI, Anthropic Claude, Google Maps, Mapbox,
  HERE, and OpenStreetMap
- `provider_execution_logs`
- payment webhook secret validation
- worker secret validation
- server-side secret references in provider records
- outbound webhook delivery through the `provider.queue.webhook-delivery` adapter
- signed sandbox webhook receiver for hosted delivery gates

Required remediation:

- live vendor adapter certification before production vendors are enabled
- non-2xx receiver retry/dead-letter evidence on hosted Supabase

Business modules must never call vendor APIs directly.
