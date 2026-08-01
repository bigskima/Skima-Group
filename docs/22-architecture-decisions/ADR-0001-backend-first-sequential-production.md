# ADR-0001: Backend-First Sequential Production

Status: Accepted

Decision:

Skima will complete backend foundation, runtime engines, module framework, and no-frontend backend
E2E verification before frontend implementation.

Consequences:

- Milestone status must be evidence-based.
- UI work was paused until backend approval; Milestones 1-3 were approved on 2026-07-30, so
  Milestone 4 frontend foundation work is now unblocked.
- Runtime engines must execute operations, not only store configuration.
- Sandbox adapters are allowed for development gates when interfaces, idempotency, errors, logs, and
  secret boundaries are production-shaped.
