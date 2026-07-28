# Known Limitations

Current known backend limitations:

- Milestone 4 UI work is intentionally paused.
- Runtime remediation and dispatch repair migrations have been pushed to the hosted Supabase dev
  project, but reviewer approval is still pending.
- Full no-frontend LPG lifecycle passed but is not yet reviewer-approved.
- Outbound webhook delivery runtime has been pushed and deployed, but still needs refreshed
  super-admin remote gate evidence and webhook-aware lifecycle gate evidence.
- Non-2xx outbound webhook retry/dead-letter behavior still needs a dedicated hosted failure
  scenario.
- Live payment, notification, maps, and AI vendors are not enabled; deterministic sandbox adapters
  are used for development gates.
- Gemini and map provider catalog records exist, but live provider calls require server-side
  secrets, adapter certification, cost/rate monitoring, and response validation before production
  enablement.
- Production backup/PITR and monitoring alert evidence must be confirmed before production.
