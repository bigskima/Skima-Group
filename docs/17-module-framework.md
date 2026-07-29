# Module Framework

Business modules are configurable plugins.

Implemented:

- module registry
- module versions
- module component bindings
- dispatch policy component bindings
- lifecycle events
- LPG module configuration
- module-backed service request lifecycle through generic runtime RPCs
- reusable business application type configuration for onboarding approved partner organizations
  without hardcoding LPG behavior
- reusable driver and vehicle application type configuration for approving drivers, vehicle specs,
  ownership evidence, capabilities, and dispatch eligibility without hardcoding module logic
- reusable organization staff runtime for branch-scoped roles, invitations, suspension/reactivation,
  ownership transfer, and anti-escalation checks without granting platform-admin permissions
- reusable catalog and availability runtime for module-bound products, services, categories,
  variants, units, prices, media, stock/capacity, schedules, and orderability validation without
  module-specific platform logic
- reusable order operations runtime for module-backed order creation, acceptance, rejection,
  preparation, pickup readiness, fulfilment, completion, reassignment, immutable order events, and
  stock reservation effects through configured workflow/action policies
- module-backed finance lifecycle for deposits, escrow funding, driver commission, business
  settlement, withdrawal, communication, and OTP without LPG-specific platform logic

Required before Milestone 4 approval:

- reviewer approval for the hosted Milestones 1-3 backend evidence
- live vendor certification before public production launch
