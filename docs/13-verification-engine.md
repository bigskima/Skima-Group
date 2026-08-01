# Verification Engine

Verification answers who scanned, what was scanned, why, where, when, and which event should fire.

QR code scanning is a Verification Engine use case, not a separate business-specific scanner. The
frontend later owns camera access and QR decoding. The backend owns payload validation, scan
meaning, audit, idempotency, and workflow/event progression through configured
`verification_definitions`.

Implemented:

- verification definitions
- `record_verification_event`
- optional triggering of configured platform events
- `POST /functions/v1/api-gateway/runtime/verifications`
- optional service request workflow advancement after passed verification events
- no-frontend backend lifecycle gate covers pickup, fulfillment, and delivery verification events
- QR scan policy configuration through `platform.verification.qr_scan_policy`

Remaining hardening:

- broader tests for invalid scan definition, missing scanned entity, idempotency, and additional
  triggered-event variants
