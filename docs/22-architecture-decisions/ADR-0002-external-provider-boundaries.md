# ADR-0002: External Provider Boundaries

Status: Accepted

Decision:

Skima will not rebuild mature external capabilities such as LLMs, mapping platforms, GPS, routing,
traffic, or payment rails. Skima integrates them through reusable provider adapters and keeps
business rules, orchestration, security, audit, workflow, and policy execution inside the platform.

Consequences:

- Business modules never call Gemini, Google Maps, Mapbox, HERE, OpenStreetMap, or payment gateways
  directly.
- Active AI and map providers are selected by configuration, not source-code branches.
- Gemini is the production target AI provider through an adapter, but development gates may use a
  deterministic sandbox adapter until live credentials and certification are complete.
- Map providers supply geocoding, routing, distance, ETA, traffic, and navigation data. Skima owns
  driver qualification, dispatch decisions, tracking permissions, geofence policy, workflow
  progression, and settlement triggers.
