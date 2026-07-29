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
- order operations emit `event.order.*` platform events and append-only `order_events` receipts
- hosted order operations gate proves received, accepted, reassigned, preparation started, ready,
  fulfilled, and completed events without a frontend
- deposit webhooks are persisted in append-only `payment_webhook_events`
- withdrawal, communication, and OTP lifecycles create append-only operational events/attempts
- finance/communication lifecycle gate proves deposit, withdrawal, commission, settlement,
  communication, and OTP events without a frontend

Remaining hardening:

- broader event-processing gates for order rejection, cancellation, dispute, timeout, and additional
  provider failure variants
