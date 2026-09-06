# Utility billing architecture

Utility billing is a platform commerce capability, not LPG-specific behavior. The customer app can
present electricity, airtime, data, television, education, insurance, or later services from the
same database-driven catalog.

## Provider boundary

`utility_provider_routes` maps a product to a record in the existing `provider_adapters` catalog.
No provider is selected in source code. A route becomes customer-available only when both the route
and adapter are active. Provider credentials belong in the deployment secret store referenced by
the adapter; they must never be stored in catalog configuration or a mobile build.

A provider adapter must eventually implement these operations:

1. validate a customer identifier where the biller supports validation;
2. purchase or vend the selected provider product;
3. query an ambiguous transaction before retrying;
4. normalize provider states into `processing`, `succeeded`, `failed`, or `reversed`;
5. expose a stable provider reference for webhook and reconciliation matching.

Until a compatible adapter is connected, products remain unavailable and no customer funds move.

## Paystack and SKIMA Wallet

Paystack is a payment adapter used to fund the SKIMA Wallet. The displayed wallet balance is an
append-only SKIMA ledger balance; it is not a Paystack wallet and is not passed to another provider.

The complete execution phase must use the existing financial posting engine:

1. reserve the quoted total from the customer wallet into a platform clearing or escrow wallet;
2. enqueue provider fulfillment with an idempotency key;
3. capture the reservation after authoritative provider success;
4. reverse the full reservation after authoritative failure;
5. query the provider before retrying an ambiguous network result;
6. reconcile provider settlement separately against the configured treasury or provider-prefunded
   balance.

This separation lets SKIMA accept wallet funding through Paystack while fulfilling through any
approved utility provider. It also prevents a provider timeout from charging the customer twice.

## Administrative configuration

Administrators with `platform.billing.manage` configure categories, billers, products, routes, and
promotions. Promotions support fixed or percentage discounts, start/end windows, minimum spend,
caps, and usage-limit metadata. The customer request stores the resolved promotion and monetary
snapshot so later configuration changes cannot rewrite its history.

Provider routes should remain inactive until credential, sandbox, webhook, failure-reversal, and
reconciliation tests pass for the chosen provider.
