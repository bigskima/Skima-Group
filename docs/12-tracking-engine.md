# Tracking Engine

Tracking stores backend movement data only. Frontend map rendering is out of scope.

Implemented:

- tracking sessions
- tracking points
- tracking status receipts
- `POST /functions/v1/api-gateway/runtime/tracking/sessions`
- `POST /functions/v1/api-gateway/runtime/tracking/points`
- active session validation inside `record_tracking_point`

Required remediation:

- E2E proof that location updates are persisted and auditable
