# Tracking Engine

Tracking stores backend movement data only. Frontend map rendering is out of scope.

Skima is not building a mapping platform, GPS system, road-routing algorithm, or traffic engine.
Those capabilities come from map providers through adapters. The backend owns tracking
permissions, location security, geofence policy, workflow integration, dispatch decisions, and
settlement-triggering events.

Implemented:

- tracking sessions
- tracking points
- tracking status receipts
- `POST /functions/v1/api-gateway/runtime/tracking/sessions`
- `POST /functions/v1/api-gateway/runtime/tracking/points`
- active session validation inside `record_tracking_point`
- map provider catalog records for Google Maps, Mapbox, HERE, OpenStreetMap, and sandbox maps

Required remediation:

- live map adapter execution after provider keys are configured as Supabase secrets
- E2E proof that location updates are persisted and auditable

Business modules must call the Location Service and Map Provider Adapter, not map vendors directly.
