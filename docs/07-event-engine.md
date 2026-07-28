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
- dedicated hosted dead-letter gate script: `npm run supabase:webhook:dead-letter`

Required remediation:

- hosted execution of `npm run supabase:webhook:dead-letter`
