# Business Module Framework

Milestone 3 makes business modules configurable plugins. A module defines how it uses platform
engines; it does not modify those engines.

## Core Tables

- `business_modules`
- `business_module_versions`
- `business_module_components`
- `business_module_events`

Modules are versioned. Only one version can be active for a module at a time, and activation
requires at least one active component.

## Components

`business_module_components` is the normalized binding table for everything a module can define:

- capabilities
- workflows
- pricing policies
- settlement policies
- events
- permissions
- vehicle requirements
- driver requirements
- document requirements
- AI behaviors
- reports
- screens

Component references point to existing platform engine records by key. Activation validates that
referenced records are active, so modules plug into engines through configuration instead of source
code changes.

## Runtime Rules

Module configuration goes through:

- `configure_business_module`
- `configure_business_module_version`
- `configure_business_module_component`
- `activate_business_module_version`
- `retire_business_module`

Business module lifecycle events are append-only. Authenticated clients cannot directly insert,
update, or delete module registry records; platform admins use the database functions through
Supabase RPC or the API gateway.

No business module is registered by the framework migration. Specific modules are added later as
configuration.

## First Module

`supabase/migrations/20260728010000_lpg_module_configuration.sql` configures the first LPG module.
It does not add LPG-specific platform functions. It seeds reusable engine records and binds them
into an active module version:

- fixed pricing policy
- escrow settlement policy
- database-stored fulfillment workflow
- event definitions
- verification definitions
- nearest qualified driver dispatch policy
- module-scoped permissions
- vehicle and driver requirements
- assist-only AI behavior
- report and screen blueprint references

The module can be retired or replaced by module configuration without rewriting the platform
engines.
