# Known Limitations

Current known backend limitations:

- Milestone 4 frontend work is paused until Milestones 1-3 backend domains are complete and
  approved.
- Supabase Free plan does not include production-grade PITR or Log Drains. This does not block
  hosted development gates, but production launch must use an operations plan that provides recovery
  and alerting guarantees.
- Webhook-aware no-frontend lifecycle, outbound webhook gates, and finance/communication gates
  passed on hosted Supabase. Reviewer approval is still pending.
- Supabase Storage buckets, object policies, document upload registration, and document review have
  hosted E2E evidence; document expiry workers and quarantine provider execution remain pending.
- Business, driver, and vehicle application approval runtimes have hosted E2E evidence. Driver and
  vehicle expiry, suspension/reactivation, fleet reassignment, and ownership-transfer edge cases
  still need dedicated gates.
- Dispatch eligibility now requires approved drivers, active approved vehicles, active
  driver-vehicle authorization links, and configured driver/vehicle capability matches. Broader
  distance, zone, priority, capacity-limit, and manual-override scenarios remain open.
- Business staff invitations, branch-scoped roles, suspension/reactivation, and ownership-transfer
  guardrails have hosted E2E evidence. Cross-organization staff negative gates and richer role
  template coverage remain open.
- Catalog, availability, stock/capacity, media linking, and customer orderability APIs have hosted
  E2E evidence. Broader schedule/effective-date/capacity edge cases remain open.
- Order receiving and processing APIs have hosted E2E evidence for create, accept, assign, prepare,
  ready, fulfil, complete, stock reservation/consumption, events, notifications, and audit.
  Rejection, cancellation, dispute, timeout, reassignment transition, and cross-organization
  negative gates remain open.
- NGN deposit, withdrawal, transfer, beneficiary verification, payment webhook processing, duplicate
  protection, commission, settlement, communication, and OTP runtimes are implemented and pass
  hosted sandbox-adapter gates.
- Live payment, notification, maps, and AI vendors are not enabled; deterministic sandbox adapters
  are used for development gates.
- Gemini and map provider catalog records exist, but live provider calls require server-side
  secrets, adapter certification, cost/rate monitoring, and response validation before production
  enablement.
- Production backup/PITR and monitoring alert evidence must be confirmed before public production
  launch.
