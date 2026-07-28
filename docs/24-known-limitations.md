# Known Limitations

Current known backend limitations:

- Milestone 4 UI work is intentionally paused.
- Runtime remediation and dispatch repair migrations have been pushed to the hosted Supabase dev
  project, but reviewer approval is still pending.
- Webhook-aware full no-frontend LPG lifecycle passed but is not yet reviewer-approved.
- Outbound webhook success and dead-letter gates passed but are not yet reviewer-approved.
- Live payment, notification, maps, and AI vendors are not enabled; deterministic sandbox adapters
  are used for development gates.
- Gemini and map provider catalog records exist, but live provider calls require server-side
  secrets, adapter certification, cost/rate monitoring, and response validation before production
  enablement.
- Production backup/PITR and monitoring alert evidence must be confirmed before production.
