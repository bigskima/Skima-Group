# SKIMA Financial Policy Governance Directive

## Status and scope

This is a binding implementation directive for all current and future SKIMA financial work. It
supplements the [SKIMA Platform Constitution](../SKIMA_PLATFORM_CONSTITUTION.md) and applies to
every service module, including LPG, without making the reusable platform engines specific to any
one business.

## Core requirement

Every SKIMA financial policy that the company intends to adjust must be configurable through the
SKIMA company Admin Dashboard.

Do not hardcode production financial rules into mobile applications, frontend components, Edge
Functions, or isolated SQL constants when those rules are intended to be business policy. The
backend remains authoritative; the dashboard is only the controlled management surface.

The required control flow is:

```text
Admin Dashboard
    -> authorized backend policy/configuration API
    -> versioned policy records
    -> pricing / commission / settlement engines
    -> quotes / orders / ledger
```

The following are prohibited:

```text
Admin Dashboard -> frontend constant
Mobile App -> decides financial amount
```

All money movement must continue through the authoritative financial engine and ledger. Financial
configuration must never become an alternative source of truth.

## Company-managed financial policy

This requirement includes, without limitation:

- LPG platform markup per kg
- delivery base fees, included distance, per-kilometre fees, distance bands, minimum delivery
  charges, long-distance surcharges, and service-area overrides
- driver payout rules and driver commission policies
- platform logistics margins and service-specific platform fees
- station and platform settlement rules
- withdrawal fees and permitted payment-related service charges
- refund, adjustment, and applicable cancellation-charge rules
- promotional discounts, referral rewards, and affiliate or marketplace commissions
- pricing floors and ceilings
- peak or time-based pricing rules
- future service-specific fees, commissions, and financial policies

These examples identify policy categories, not approved monetary values. Monetary values and other
business decisions must be supplied through authorized configuration, not invented in code.

## Policy lifecycle and records

The backend must represent company-managed financial policy as reusable versioned records rather
than module-specific constants. A policy record and its versioning model must support, as relevant:

- a stable policy key and policy family
- immutable policy versions and an explicit lifecycle, including activation and deactivation
- configured effective start and end times
- service/module, organization/tenant, geography/service-area, and currency scope
- a validated rule/configuration payload and safe defaults
- configured approval boundaries for sensitive changes
- the actor, approver where applicable, reason, timestamps, previous value, and new value
- a supersession/rollback relationship that preserves history

Financial-policy resolution must fail closed when a required policy is missing, invalid, inactive,
unapproved, or ambiguous: it must not create a quote, accept a payment, execute a payout, or settle
an obligation. Zero is not a safe implicit fallback; it is valid only when explicitly authorized by
the resolved policy. Development or test configuration must be clearly identified and must not
automatically become active production policy.

Rollback must be a safe versioned operation: activate a suitable superseding version rather than
editing or erasing historical policy records.

Where a policy requires approval, the backend must reject activation until the configured approval
boundary has been satisfied. Approval must be enforced by the backend transition, not inferred from
the dashboard state.

Policy selection must prevent ambiguous overlaps for the same applicable service/module,
organization or tenant, geography/service area, currency, and effective-time scope. Validation must
reject conflicts before activation unless an explicit, deterministic precedence rule is part of the
reusable policy engine.

## Authorization and delegated scope

Authorized SKIMA finance and operations administrators must be able to manage company financial
policies without editing code or redeploying the application. Backend authorization, database
policy/RLS, and policy-engine validation must enforce this; hiding a dashboard control is not
sufficient.

Partners and stations may manage only the financial settings explicitly delegated to their own
scope. For example, an LPG station may manage its own selling price where the applicable policy
permits it. It must not be able to alter:

- SKIMA markup
- driver payout policy
- platform commissions
- settlement policy
- withdrawal fees
- another station's pricing
- global financial configuration

Drivers and customers must never control authoritative financial rules or provide monetary amounts
that the backend accepts as authoritative.

## Financial snapshots and existing obligations

A pricing, commission, fee, payout, or settlement-policy change must not silently alter an already
accepted quote or active financial obligation.

When a quote or order is accepted, the backend must preserve the policy identifiers and versions,
effective configuration, calculation breakdown, currency, and immutable financial snapshot used to
create that obligation. The authoritative ledger must preserve resulting financial history.

Future policy versions apply only according to their configured effective time and applicability
rules. Reconciliation, refunds, and adjustments must be posted through the financial engine and
ledger; they must not mutate the historical quote, order, policy, or ledger record in place.

## Responsibilities by layer

| Layer | Required responsibility |
| --- | --- |
| Backend schema | Store reusable, scoped, effective-dated, versioned policy records; approvals; history; and audit evidence. |
| Policy engines | Resolve valid active policy versions, validate configuration, prevent conflicts, calculate authoritatively, and emit/snapshot results. |
| Admin APIs | Enforce RBAC, delegated scope, validation, approval transitions, change history, and auditable writes. |
| Admin UI | Provide a controlled configuration and review surface; render backend state and never calculate authoritative financial results. |
| Mobile and other clients | Submit permitted request inputs only and render backend quotes, obligations, and financial results. |
| Ledger/financial engine | Remain the sole authority for money movement, settlement, reconciliation, and financial history. |
| Documentation and tests | Document the supported policy lifecycle and boundaries, and prove them through automated tests. |

## Required auditability and test coverage

Implementation must include audit logs with actor identity and previous/new values, plus change
history and policy-version visibility for authorized users.

Automated tests must prove at least that:

- unauthorized roles cannot read or mutate restricted financial policy
- delegated station scope cannot escape its boundary
- approval and activation rules are enforced
- conflicting versions are rejected
- effective dating resolves the correct version
- audit records capture the actor and previous/new values
- rollback preserves history
- accepted quote, order, and ledger snapshots remain unchanged after later policy edits
- clients cannot establish authoritative financial amounts through request payloads

## LPG application

LPG supplies module-specific configuration to the universal pricing, commission, settlement, maps,
workflow, wallet, and ledger engines. It must not introduce LPG-only financial-governance
infrastructure when a reusable policy/configuration capability belongs in the platform.

Station-controlled LPG selling prices may be delegated where permitted. SKIMA markup, delivery
policy, driver payout, platform commissions, settlement policy, and global configuration remain
company-controlled policies governed by this directive.
