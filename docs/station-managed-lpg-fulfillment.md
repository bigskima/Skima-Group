# Station Managed LPG fulfillment — implementation notes

## Confirmed rules
- Station Managed is an additive operational fulfillment mode; `fulfillment_channel` remains the existing marketplace vs SKIMA internal commercial channel.
- A station chooses customer delivery pricing: separate fee, included in the refill price, or free.
- Customer checkout remains through SKIMA. Refill and delivery amounts are separately represented and reconciled to their beneficiaries.
- Station drivers are branch-owned identities, not SKIMA Managed Drivers or independent `driver_profiles`.
- The SKIMA admin dashboard has read-only oversight for station settings, driver assignments, agreements, and station-entered payment confirmations; it does not execute station-driver payments.
- Station Managed drivers have a separate authenticated job workspace, can accept assignments, start delivery only after station settlement, record customer arrival, complete the verified cylinder hand-over, and cannot trigger SKIMA driver payouts. The station remains responsible for driver compensation.
- Driver compensation is either an in-app station-defined plan or an offline agreement. The station records agreements and payment confirmations; SKIMA does not pay station-managed drivers.
- SKIMA Fleet and independent-driver paths remain the defaults for existing orders and retain their existing dispatch logic.

## Migration scope
`20261019090000_lpg_station_managed_fulfillment.sql` adds mode and pricing snapshots, station settings, station-driver identity/assignment, agreement and payment-record tables, branch-authorized RPCs, quote pricing snapshot logic, order snapshot propagation, and settlement/payout guards.

## Verification checklist before applying anywhere
1. Apply the migration to a disposable Supabase project seeded from the current schema, never directly to production.
2. Confirm existing marketplace quotes/orders remain `independent_driver`; existing `skima_internal` quotes/orders remain `skima_fleet`.
3. Quote cases: separate fee, included fee, free delivery; currency mismatch; disabled station; non-station-managed quote regression.
4. Assignment cases: valid branch manager and active station driver; cross-branch driver; unauthorized user; duplicate assignment/idempotency; unsupported order status.
5. Financial cases: separate delivery fee credits station separately from LPG principal; included fee is part of station principal; free delivery is zero; underfill refund excludes unearned delivery compensation; station-managed orders cannot execute SKIMA driver commission.
6. Access cases: direct table access denied to authenticated users; branch RPC access enforced; no station driver row is inserted into `driver_profiles`, `lpg_internal_driver_earnings`, or SKIMA payout tables.
7. Verify customer fulfillment selection and quote breakdown, station settings/driver/agreement/payment UI, the separate station-driver job and hand-over workspace, admin oversight dashboard, and end-to-end payment/settlement tests.
8. Do not apply the migration or deploy functions until all checks pass and the branch diff has been reviewed.
