# Known Limitations

Current known backend limitations:

- Milestone 4 LPG frontend production work is blocked by the backend-first reset audit recorded on
  2026-08-01. The Milestones 1-3 shared backend approval remains useful evidence, but the complete
  LPG no-frontend journey in `docs/32-lpg-backend-first-reset-audit.md` must pass before rebuilding
  production LPG screens.
- Initial backend-owned public reference runtime and gateway response wiring exist for LPG
  cylinders, quotes, orders, scan sessions, payment deposits, withdrawals, commissions, and
  settlement statements. The migration has not been applied from this shell, and hosted E2E evidence
  is still pending.
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
- NGN deposit, withdrawal, transfer, beneficiary verification, signed payment webhook processing,
  duplicate protection, commission, settlement, communication, and OTP runtimes are implemented.
  Paystack webhook signature verification and backend transaction initialization now exist; hosted
  sandbox-adapter gates still cover deterministic non-vendor paths.
- Live notification, maps, and AI vendors are not enabled; deterministic sandbox adapters are used
  for development gates.
- Resend and Twilio are disabled by configuration until production communication delivery resumes.
- Current OTP is backend-generated, stored in protected backend delivery records, fetched only
  through the authenticated in-app delivery RPC for `in_app` challenges, and verified through the
  platform OTP engine. It is intentionally not an SMS, WhatsApp, or email OTP replacement while
  those providers are paused.
- Gemini and map provider catalog records exist, but live provider calls require server-side
  secrets, adapter certification, cost/rate monitoring, and response validation before production
  enablement.
- Production backup/PITR and monitoring alert evidence must be confirmed before public production
  launch.
