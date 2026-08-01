# Notification Engine

Notification messages are queued records with provider adapter references.

Notification is part of the broader Communication Engine. The backend supports email, SMS, WhatsApp,
and in-app message records plus OTP request/verification through provider adapters.

Current development mode:

- Resend and Twilio provider records stay in the catalog but are `disabled`.
- External email, SMS, and WhatsApp delivery is paused until production provider approval.
- OTP remains backend-generated and verified through `request_otp_challenge` and
  `verify_otp_challenge`.
- The app may fetch an in-app OTP through `/runtime/otp/delivery` only for the authenticated owner
  of an unexpired `in_app` challenge. The frontend is never the authority that creates, stores, or
  validates OTP codes.

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
- protected `otp_delivery_codes` storage with no direct authenticated table reads
- owner-only in-app OTP delivery through `fetch_in_app_otp_code`
- OTP verification with expiry, attempt limits, purpose scoping, and one-time-use status through
  `verify_otp_challenge`
- append-only communication events, OTP delivery access records, and OTP attempts
- sandbox communication adapter execution through notification messages and provider logs

Hosted evidence:

- `npm run supabase:finance-communication:e2e` proves communication queueing, redacted OTP payloads,
  blocked direct OTP-code table reads, owner-only in-app OTP fetch, wrong-code rejection,
  correct-code verification, worker-backed delivery sync, and append-only OTP attempt protection.
- Live email, SMS, and WhatsApp provider adapters remain disabled until production-launch
  certification work resumes.
