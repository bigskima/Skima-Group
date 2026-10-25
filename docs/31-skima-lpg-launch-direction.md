# Skima LPG Launch Direction

Skima LPG is the current Phase 1 launch product. The initial customer platform launch is Nigeria-first, while operational LPG coverage expands by verified service area. National platform availability must not be described as nationwide delivery availability.

The reusable Skima platform engines remain in place for authentication, profiles, organisations, permissions, wallets, ledgers, payments, escrow or fund reservation, settlements, commissions, notifications, OTP, media, audit logs, events, workflows, maps adapters, and tracking.

The launch product is not a general logistics, commerce, ride-hailing, parcel-delivery, food-delivery, or generic marketplace application. The user-facing mobile experience is the dedicated `apps/lpg-mobile` application.

## Launch Workspaces

The LPG mobile launch app has three authorised workspaces:

- Customer
- Driver
- Station

The backend remains authoritative for workspace access. Switching the visible workspace does not grant a role.

## Customer service availability

Customers provide their delivery location and refill requirements. SKIMA checks serviceability and backend-eligible fulfilment options before offering an actionable quote or accepting an order.

The system must distinguish:
- SKIMA Managed fulfilment;
- Station Managed fulfilment through the station's own approved operational workflow; and
- Independent delivery through the existing independent-provider workflow.

Do not merge these operational models or treat a registered station as sufficient evidence of availability. Product/stock eligibility, service coverage, branch and provider status, delivery capacity, safety requirements, and configured policies must be evaluated. If no valid fulfilment path exists, do not create a payable or confirmed LPG order. Where supported, show a clear unavailable state and expansion-interest option.

The platform can be accessible nationally in Nigeria while individual services remain jurisdiction-, provider-, and operational-readiness-dependent. Bill payments are available only for supported products, billers and enabled payment rails. LPG delivery is available only where a valid fulfilment path exists.

## LPG Journey

1. Customer supplies the delivery location and selects their registered cylinder/product and requested refill quantity.
2. Backend resolves serviceability and eligible fulfilment paths for the destination and requested product.
3. Backend returns only valid options and creates an authoritative quote using the existing pricing and financial-policy engines.
4. Customer confirms the quote and payment through the existing SKIMA payment lifecycle.
5. Backend revalidates eligibility and assigns the order to the correct workflow:
   - SKIMA Managed uses the approved managed network;
   - Station Managed uses the station branch's own approved workflow and delivery capacity;
   - Independent delivery uses the existing independent-driver workflow.
6. Provider accepts and completes the appropriate pickup, refill, inspection, delivery and verification steps.
7. Existing settlement, refund, driver/station compensation, ledger and audit flows remain authoritative for the selected mode.
8. Customer tracks the order and verifies delivery using the supported OTP/QR workflow.

A Station Managed station may serve both its own customers and eligible customers/orders sourced by SKIMA. SKIMA-generated order allocation must follow backend eligibility and configured platform policy. Station-owned drivers must remain distinct from independent or SKIMA-managed driver identities.

## No Hardcoded Operational Data

Do not hardcode order references, cylinder references, cylinder photographs, customer names, driver names, vehicle details, station details, prices, balances, ETAs, coordinates, workflow status, scan results, settlements, commissions, service areas, provider availability or affiliate rates/durations.

Generic SKIMA-owned illustrations may be used only for onboarding, empty states, safety guidance, and loading placeholders.

## Station affiliate referrals

A future station affiliate programme should attribute approved referrals to station organisations/branches and pay a configured, limited-time commission from eligible SKIMA fees actually collected from the referred station. Referral attribution, activation criteria, eligible fee categories, rate, earning period, thresholds, reversals and payout policy must use the existing reusable referral, financial-policy, commission and ledger infrastructure where available. Production rates and durations must not be hardcoded or assumed.

## Financial Policy Governance

All LPG pricing, markup, delivery-fee, commission, payout, settlement, fee, discount, refund, and adjustment work must comply with the universal [SKIMA Financial Policy Governance Directive](32-financial-policy-governance-directive.md).

LPG is a module of the reusable financial platform. The dashboard must allow authorized SKIMA finance and operations administrators to manage applicable policy configuration through backend APIs, while the backend engines and ledger remain authoritative. A station may control only its explicitly delegated pricing records; it may not alter SKIMA-wide financial policy. Accepted LPG quotes and orders must preserve the immutable financial snapshot and resolved policy versions used to create them.

