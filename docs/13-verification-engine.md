# Verification Engine

Verification answers who scanned, what was scanned, why, where, when, and which event should fire.

Implemented:

- verification definitions
- `record_verification_event`
- optional triggering of configured platform events
- `POST /functions/v1/api-gateway/runtime/verifications`
- optional service request workflow advancement after passed verification events
- no-frontend backend lifecycle gate covers pickup, fulfillment, and delivery verification events

Remaining hardening:

- broader tests for invalid scan definition, missing scanned entity, idempotency, and additional
  triggered-event variants
