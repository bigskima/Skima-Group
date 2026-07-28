# ADR-0003 Free-Plan Operations Gate

## Status

Accepted.

## Context

The hosted Supabase development project currently uses the Free plan. Production-grade PITR and Log
Drains are not available on this plan, but Edge Function invocations and logs are visible in the
Supabase dashboard.

## Decision

Milestone 1 is considered complete for frontend foundation work because the backend runtime,
security, hosted migration, function deployment, and no-frontend lifecycle gates passed. Free-plan
PITR and Log Drains are recorded as public production-launch hardening requirements.

## Consequences

- Milestone 4 may begin.
- The app can be built and functionally validated on the hosted dev project.
- Public production launch must not proceed until backup/recovery and alerting evidence are
  confirmed on an appropriate Supabase plan or equivalent operations provider.
