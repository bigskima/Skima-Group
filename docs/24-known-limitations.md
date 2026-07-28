# Known Limitations

Current known backend limitations:

- Milestone 4 UI work is intentionally paused.
- Runtime remediation has not been pushed to the hosted Supabase dev project in this evidence pass.
- Full no-frontend LPG lifecycle evidence is scripted but not yet approved.
- Outbound webhook delivery for configured `webhook_endpoints` still needs execution and retry
  tests.
- Live payment, notification, maps, and AI vendors are not enabled; deterministic sandbox adapters
  are used for development gates.
- Production backup/PITR and monitoring alert evidence must be confirmed before production.
