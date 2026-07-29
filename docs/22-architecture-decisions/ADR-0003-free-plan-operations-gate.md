# ADR-0003 Free-Plan Operations Gate

## Status

Accepted.

## Context

The hosted Supabase development project currently uses the Free plan. Production-grade PITR and Log
Drains are not available on this plan, but Edge Function invocations and logs are visible in the
Supabase dashboard.

## Decision

The Free-plan PITR and Log Drains limitations do not prevent hosted development validation, but they
also do not approve Milestone 4. Milestone 4 remains blocked until a reviewer approves the
Milestones 1-3 backend evidence recorded in `docs/26-backend-domain-audit.md`.

## Consequences

- Milestone 4 remains paused until reviewer approval.
- The backend can be functionally validated on the hosted dev project with deterministic sandbox
  adapters.
- Public production launch must not proceed until backup/recovery and alerting evidence are
  confirmed on an appropriate Supabase plan or equivalent operations provider.
