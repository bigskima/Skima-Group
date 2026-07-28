# Event Engine

Events are persisted through `record_platform_event`.

Implemented:

- active event type validation
- idempotency by source and key
- append-only event logs through direct insert blocking
- service request event processing through `process_service_request_event`
- runtime worker surface for queued jobs and provider execution
- payment webhook event intake

Required remediation:

- E2E proof that configured events trigger workflow advancement and operational side effects
- webhook delivery generation for configured outbound endpoints
- deeper retry/dead-letter tests for failure scenarios
