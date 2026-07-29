# Notification Engine

Notification messages are queued records with provider adapter references.

Notification is part of the broader Communication Engine. The backend supports email, SMS, WhatsApp,
and in-app message records plus OTP request/verification through provider adapters.

Implemented:

- notification templates
- queued messages
- status events
- sandbox notification adapter execution through `runtime-worker`
- provider execution logs for delivery attempts
- authenticated queue API route
- order status notifications queued from `create_order_from_catalog` and `process_order_action`
  using the reusable in-app notification template
- hosted order operations gate verifies order notifications are queued
- communication messages for email, SMS, WhatsApp, and in-app channels
- `queue_communication_message`
- `sync_communication_message_statuses`
- OTP challenges through `request_otp_challenge`
- OTP verification with expiry, attempt limits, purpose scoping, and one-time-use status through
  `verify_otp_challenge`
- append-only communication events and OTP attempts
- sandbox communication adapter execution through notification messages and provider logs

Hosted evidence:

- `npm run supabase:finance-communication:e2e` proves communication queueing, wrong-code rejection,
  correct-code verification, worker-backed delivery sync, and append-only OTP attempt protection.
- Live email, SMS, and WhatsApp provider adapters remain production-launch certification work.
