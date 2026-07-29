# CR-0001: Backend-First Remediation

Requested change:

Pause frontend work and audit/remediate Milestones 1-3 until the backend can demonstrate a complete
no-frontend lifecycle.

Required outcomes:

- evidence-based milestone status
- executable runtime engines
- required Edge Functions/workers/webhooks
- automated backend integration and security tests
- updated documentation
- production-readiness report
- reviewer approval before Milestone 4

Superseded by:

- `CR-0002-pause-milestone-4-backend-domain-remediation.md`, which expands the backend-first scope
  to include onboarding, documents, staff, catalog, real NGN payments, withdrawals, communication,
  OTP, and additional E2E gates before frontend work resumes.

Resolution:

- The expanded hosted development backend gates now pass for Milestones 1-3 and are recorded in
  `docs/26-backend-domain-audit.md`. Reviewer approval remains pending.
