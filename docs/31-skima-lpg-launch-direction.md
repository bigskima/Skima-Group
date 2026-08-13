# Skima LPG Launch Direction

Skima LPG is the current Phase 1 launch product.

The reusable Skima platform engines remain in place for authentication, profiles, organisations,
permissions, wallets, ledgers, payments, escrow or fund reservation, settlements, commissions,
notifications, OTP, media, audit logs, events, workflows, maps adapters, and tracking.

The launch product is not a general logistics, commerce, ride-hailing, parcel-delivery, food
delivery, or generic marketplace application. The user-facing mobile experience is the dedicated
`apps/lpg-mobile` application.

## Launch Workspaces

The LPG mobile launch app has three authorised workspaces:

- Customer
- Driver
- Station

The backend remains authoritative for workspace access. Switching the visible workspace does not
grant a role.

## LPG Journey

The production journey is:

1. Customer registers an LPG cylinder.
2. Customer uploads real cylinder photographs.
3. Customer selects the refill quantity.
4. Backend creates the quote.
5. Customer pays.
6. Skima selects an eligible LPG station.
7. Skima assigns an eligible independent driver.
8. Driver accepts the job.
9. Driver collects and scans the cylinder.
10. Driver takes the cylinder to the assigned LPG station.
11. Station staff scan and inspect it.
12. Station records actual kilograms filled.
13. Station settlement is processed.
14. Driver returns the cylinder.
15. Customer tracks delivery.
16. Customer verifies delivery with OTP or QR.
17. Driver commission is processed.
18. Order is completed.

Every production customer, driver, and station screen should support this journey and source
operational records from the LPG backend.

## No Hardcoded Operational Data

Do not hardcode order references, cylinder references, cylinder photographs, customer names, driver
names, vehicle details, station details, prices, balances, ETAs, coordinates, workflow status, scan
results, settlements, or commissions.

Generic Skima-owned illustrations may be used only for onboarding, empty states, safety guidance,
and loading placeholders.

## Financial Policy Governance

All LPG pricing, markup, delivery-fee, commission, payout, settlement, fee, discount, refund, and
adjustment work must comply with the universal
[SKIMA Financial Policy Governance Directive](32-financial-policy-governance-directive.md).

LPG is a module of the reusable financial platform. The dashboard must allow authorized SKIMA
finance and operations administrators to manage applicable policy configuration through backend
APIs, while the backend engines and ledger remain authoritative. A station may control only its
explicitly delegated pricing records; it may not alter SKIMA-wide financial policy. Accepted LPG
quotes and orders must preserve the immutable financial snapshot and resolved policy versions used
to create them.

