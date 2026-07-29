# CR-0002: Pause Milestone 4 For Backend Domain Remediation

Requested change:

Pause Milestone 4 frontend work and expand Milestones 1-3 backend scope to cover real operational
domains before any UI foundation resumes.

Accepted requirements:

- business application and approval
- driver, vehicle, capability, and ownership approval
- business staff and branch-scoped authorization
- business catalog, availability, stock/capacity, and order processing
- real NGN deposits and withdrawals through provider adapters
- driver commission and business settlement execution
- workflow and event runtime integration with domain services
- email, SMS, WhatsApp, in-app notifications, and OTP verification
- no-frontend E2E gates for each critical flow

Decision:

Milestone 4 is `Not Started` and blocked until the backend remediation audit in
`docs/26-backend-domain-audit.md` is implemented, tested, documented, and approved.

Resolution:

- The backend remediation audit is implemented and hosted gates are passing for Milestones 1-3.
- Milestone 4 remains blocked only by reviewer approval and public-launch provider/operations
  hardening, not by missing hosted-development backend runtime.
