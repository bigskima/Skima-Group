# Provider Adapters

Provider adapters isolate replaceable external systems.

Implemented:

- provider adapter records
- shared TypeScript provider registry contract
- deterministic sandbox adapters for payment, notification, maps, AI, queue, cache, and
  observability
- `provider_execution_logs`
- payment webhook secret validation
- worker secret validation
- server-side secret references in provider records

Required remediation:

- live vendor adapter certification before production vendors are enabled
- outbound webhook delivery execution for configured webhook endpoints
