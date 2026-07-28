# ADR-0001: Backend-First Sequential Production

Status: Accepted

Decision:

Skima will complete backend foundation, runtime engines, module framework, and no-frontend backend
E2E verification before frontend implementation.

Consequences:

- Milestone status must be evidence-based.
- UI work is paused until backend approval.
- Runtime engines must execute operations, not only store configuration.
- Sandbox adapters are allowed for development gates when interfaces, idempotency, errors, logs, and
  secret boundaries are production-shaped.
