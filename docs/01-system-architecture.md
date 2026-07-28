# System Architecture

Skima is a Supabase-backed platform for logistics, commerce, mobility, and fulfillment modules.

The backend is organized around:

- Supabase Auth for identity.
- PostgreSQL schemas, RLS, triggers, and RPCs for platform engines.
- Edge Functions for HTTP gateways, provider webhooks, and workers.
- Business modules as database configuration bound to reusable engines.
- Provider adapters as configurable records with server-side secret references.

External platforms provide specialized capabilities. Gemini or another AI vendor provides model
intelligence; Google Maps, Mapbox, HERE, or OpenStreetMap provide map/location data; payment
gateways process payments. Skima coordinates those services through adapters and keeps platform
decisions inside reusable engines.

Frontend clients are downstream consumers. They must not define backend behavior.
