# Event Engine

Events are persisted through `record_platform_event`.

Implemented:

- active event type validation
- idempotency by source and key
- append-only event logs through direct insert blocking
- service request event processing through `process_service_request_event`
- runtime worker surface for queued jobs and provider execution
- payment webhook event intake
- automatic outbound webhook delivery creation for configured webhook endpoints
- signed outbound webhook attempts, retry scheduling, and dead-letter recording

Required remediation:

- E2E proof for the webhook delivery runtime inside the service-request lifecycle
- deeper retry/dead-letter tests for non-2xx receiver failure scenarios
