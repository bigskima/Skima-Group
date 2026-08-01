# ADR-0003 Free-Plan Operations Gate

## Status

Accepted.

## Context

The hosted Supabase development project currently uses the Free plan. Production-grade PITR and Log
Drains are not available on this plan, but Edge Function invocations and logs are visible in the
Supabase dashboard.

## Decision

The Free-plan PITR and Log Drains limitations do not prevent hosted development validation. The
reviewer approved the Milestones 1-3 backend evidence on 2026-07-30, so Milestone 4 frontend
foundation work may begin while public production launch remains blocked on backup/recovery and
alerting evidence.

## Consequences

- Milestone 4 is unblocked by the 2026-07-30 backend approval.
- The backend can be functionally validated on the hosted dev project with deterministic sandbox
  adapters.
- Public production launch must not proceed until backup/recovery and alerting evidence are
  confirmed on an appropriate Supabase plan or equivalent operations provider.
