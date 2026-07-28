# Known Limitations

Current known backend limitations:

- Milestone 4 reusable frontend foundation is now active.
- Supabase Free plan does not include production-grade PITR or Log Drains. This does not block app
  build/functionality on the hosted dev project, but production launch must use an operations plan
  that provides recovery and alerting guarantees.
- Webhook-aware full no-frontend LPG lifecycle passed and is approved to unblock Milestone 4.
- Outbound webhook success and dead-letter gates passed and are approved to unblock Milestone 4.
- Live payment, notification, maps, and AI vendors are not enabled; deterministic sandbox adapters
  are used for development gates.
- Gemini and map provider catalog records exist, but live provider calls require server-side
  secrets, adapter certification, cost/rate monitoring, and response validation before production
  enablement.
- Production backup/PITR and monitoring alert evidence must be confirmed before public production
  launch.
