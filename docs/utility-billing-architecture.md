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


## Production fulfillment runtime

A customer utility purchase is not sent directly from the mobile app to a provider. The canonical
runtime is:

1. create the immutable utility request and economics snapshot;
2. reserve the customer total from the SKIMA Wallet into platform clearing;
3. when a marketing/sponsor subsidy is required, reserve that amount from the dedicated utility
   campaign funding pool into the same clearing boundary;
4. let the runtime worker claim the request with `FOR UPDATE SKIP LOCKED`;
5. call the selected provider adapter exactly once for the initial purchase;
6. if the provider returns a definitive success, settle the reservation into provider settlement,
   protected SKIMA contribution, utility cost reserve and any customer cashback;
7. if the provider returns a definitive failure, refund the customer reservation and return any
   campaign subsidy to the funding pool;
8. if the provider request times out, is rate-limited, or has an ambiguous/network result, keep the
   request in `processing` and query provider status before any new purchase attempt.

The platform clearing balance intentionally retains the configured collection-cost allocation and
operating reserve. Only the protected contribution snapshot is posted to the SKIMA revenue wallet,
so campaign/risk allowances are not accidentally presented as withdrawable profit.

Cashback is credited only on provider-confirmed success. A failed request cannot consume cashback or
a marketing/sponsor subsidy.

## Provider readiness gate

Installing an adapter or successfully reading its catalogue does not make it production-ready.
Before customer routes can activate, an administrator must:

1. configure the provider credential as a Supabase Edge Function secret;
2. pass the non-spending API connectivity check;
3. sync and inspect the provider catalogue;
4. run an explicit small real-money vend against an account controlled by SKIMA;
5. confirm the provider transaction reaches `succeeded`;
6. configure route economics and verify the protected profit floor.

The real-money readiness endpoint requires an explicit confirmation flag and enforces a maximum
single test amount. Only a successful real vend marks `runtimeReady=true`.

## Campaign funding

Ordinary margin-funded offers consume only the safe margin remaining after provider cost,
collection-cost allocation, operating reserve and minimum SKIMA contribution.

Marketing-budget and sponsor-funded offers use a dedicated non-withdrawable platform campaign wallet. Admin
must first move already-earned SKIMA revenue into that pool. At request creation, the required
subsidy is financially reserved before the provider call. This prevents the platform from promising
cashback or discounts that it cannot fund.

## Reconciliation boundary

Provider status polling is the first ambiguity-recovery mechanism and prevents duplicate vending.
Provider-specific callbacks/webhooks may later accelerate reconciliation, but must converge on the
same canonical utility request and financial finalization functions.

A reversal reported after a request has already reached final `succeeded` status requires the
separate post-settlement reversal/clawback policy and must not be emulated by retrying the original
purchase.
