# AI Agent Operating Rules

This repository is governed by [SKIMA_PLATFORM_CONSTITUTION.md](SKIMA_PLATFORM_CONSTITUTION.md).

Before writing or changing code, every AI agent must verify that the change is:

- Reusable
- Business-agnostic
- Configuration driven
- Workflow driven
- Policy driven
- Event driven where appropriate
- Provider-agnostic through adapters
- Safe for future modules that do not exist yet

## Non-Negotiables

- Never hardcode business logic into platform engines.
- Never make the platform know whether it is serving LPG, food delivery, pharmacy, ride hailing,
  courier, or another business.
- Businesses plug into the platform through modules and configuration. They must not modify platform
  engines.
- Store workflows in the database, not inside business logic.
- Use provider adapters for payments, maps, storage, AI, notifications, and other replaceable
  services.
- If a new business requires editing core platform engines, stop and redesign.

## Architecture Order

Build in this order:

1. Identity
2. Organizations
3. Reusable platform engines
4. Workflow engine
5. Business modules
6. Reusable frontend
7. Artificial intelligence

## Coding Bias

Prefer engines, policies, events, workflows, adapters, configuration records, and reusable UI
primitives over one-off screens or business-specific branches.
