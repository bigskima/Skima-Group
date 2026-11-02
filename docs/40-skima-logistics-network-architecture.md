# SKIMA Logistics Network — Architecture Foundation

**Status:** Initial architecture baseline  
**Repository:** `bigskima/Skima-Group`  
**Backend:** Existing SKIMA Supabase project  
**Application:** New, separately deployed Expo application at `apps/logistics-mobile`

## 1. Product boundary

SKIMA Logistics is a nationwide, multi-provider logistics marketplace. It is not an LPG feature and it is not a SKIMA-owned fleet.

The platform has two separately deployed customer-facing applications:

- **SKIMA Commerce / SKIMA LPG:** continues to serve SKIMA-owned commerce and fulfilment, including LPG, fuel, diesel, kerosene, bills and SKIMA Store. Its three existing fulfilment modes and their permissions remain unchanged.
- **SKIMA Logistics:** serves logistics customers, independent logistics companies and their drivers. A customer can use this app without installing or registering in SKIMA LPG.

Both applications use the existing SKIMA identity and backend infrastructure. A link from SKIMA Commerce to SKIMA Logistics may be added later as an optional deep link; it is not a dependency of the new marketplace.

## 2. Architecture rules

1. Reuse platform engines; do not copy authentication, organisation, wallet, ledger, geography, notification, storage, verification or settlement infrastructure.
2. Keep marketplace-specific records and policies in a logistics domain. Do not expose LPG, fuel or store records to a logistics company by virtue of its organisation membership.
3. Keep service categories, company capabilities, pricing modes, coverage, job requirements and fee schedules configurable in the database.
4. A logistics organisation controls its own services, service coverage, prices, staff, drivers, vehicles, availability and job fulfilment.
5. SKIMA controls marketplace discovery, provider verification rules, platform fees, permissions, dispute processes and payment/escrow infrastructure.
6. Never accept client-supplied fee totals, commissions, wallet balances or settlement distributions as authoritative. Resolve them on the server and preserve immutable snapshots.
7. All company and staff data must be tenant-isolated by organisation. Platform administration is separate from company administration.
8. Financial posting must use the existing ledger/financial runtime; no direct client writes to financial tables.
9. No new logistics migration is to be applied to production until its RLS, financial, idempotency and regression tests pass.

## 3. Existing shared infrastructure discovered

The production SKIMA Supabase project is active and already contains reusable platform records/tables for:

- Identity: `profiles`, Supabase Auth.
- Organisations and staff: `organizations`, `organization_memberships`, `organization_branches`, `roles`, `user_roles`.
- Company / driver / fleet: `partner_profiles`, `driver_profiles`, `vehicles`, `driver_vehicle_links`, `fleet_partners`.
- Geography and dispatch: `geographies`, `geography_levels`, `dispatch_policies`, `dispatch_requests`.
- Modular runtime: `business_modules`, `business_module_versions`, `business_module_components`, `workflow_definitions`, `event_types`.
- Generic service runtime: `service_requests`, `price_quotes`, `order_records`, `order_assignments`.
- Financial infrastructure: `wallet_accounts`, `financial_transactions`, `escrow_holds`, `settlement_executions`, `commission_executions`, `settlement_statements`.

The live module registry currently contains `lpg`, `fuel` and `store`. The logistics-network module has not yet been registered.

### Important reuse constraint

The generic service and quote tables are useful platform infrastructure, but their current ownership and RLS model is centred on the service requester and the request's organisation. A multi-company marketplace quote is a distinct provider-to-customer relationship. Do not assume the generic quote table already provides safe provider-tenant visibility. Inspect the associated RPCs, policies and settlement procedures before deciding whether to extend it or create logistics-specific marketplace records.

## 4. New logistics domain

The following is the proposed domain model. Before generating the production migration, compare each proposed entity against the complete schema and existing governance tables to avoid duplicates.

| Domain entity | Responsibility |
|---|---|
| Service categories | Admin-managed, hierarchical, active/inactive service taxonomy |
| Company profile | Logistics business profile linked to an existing organisation |
| Company services | The services a company offers, its capabilities, pricing mode and requirements |
| Service coverage | City/LGA/state coverage and supported origin-destination routes |
| Job request | Customer's requested work, cargo, photos, pickup/drop-off, schedule and constraints |
| Provider match | Qualified company opportunity with match explanation and lifecycle |
| Quote / offer | Company price, ETA, terms and offer expiry |
| Negotiation message | Customer/provider conversation and counteroffer history |
| Booking | Confirmed company, accepted offer, payment mode and immutable commercial snapshot |
| Driver assignment | Company-controlled assignment of an eligible driver and vehicle |
| Job event | Append-only pickup, progress, delivery, cancellation and dispute history |

All service taxonomy and capability values must be data-driven. An appliance transporter, restaurant courier and interstate bulk carrier must not be forced into one hardcoded service workflow.

## 5. Marketplace discovery and privacy

- Match using service capability, pickup and destination coverage, cargo/vehicle requirements, availability, capacity and service constraints.
- Proximity is a ranking factor, not the only eligibility rule.
- A company may offer more than one service and operate in multiple states or on interstate routes.
- Matching and eligibility must be explainable and auditable.
- Qualified providers receive the full job opportunity and customer contact access without a lead/unlock payment.
- Contact details are shared only with the qualified companies to whom the customer request is distributed, not with every company or anonymous marketplace visitor.
- A customer can compare companies, prices, ETA and terms, then negotiate before selecting an offer.

## 6. Company and driver workspace

The logistics application must expose role-specific workspaces based on server-provided session context and organisation permissions:

- **Customer:** create job, compare offers, negotiate, book, pay, track, confirm delivery and raise a complaint.
- **Company owner:** manage company profile, verification, services, coverage, prices, staff, drivers, fleet, bookings, fees and performance.
- **Dispatcher / operations staff:** see only permitted organisation jobs, allocate drivers and vehicles, manage delivery lifecycle.
- **Driver:** see assigned jobs, pickup/drop-off instructions, approved customer contact, update progress and submit delivery evidence.
- **Platform administrator:** manage the marketplace, taxonomy, provider verification, fee policies, coverage governance, complaints and analytics.

A logistics company must not gain access to SKIMA's internal LPG station, fuel inventory, SKIMA fleet, platform revenue or other companies' records.

## 7. Financial model

Each confirmed booking has one of two mutually exclusive settlement modes:

- **Offline with provider:** customer pays the company outside SKIMA. SKIMA collects the configured customer booking fee and automatically posts the configured provider receival fee to the company's fee account/ledger. No delivery settlement commission applies.
- **SKIMA-mediated:** customer pays the agreed delivery price into the SKIMA-controlled payment/escrow flow and separately pays the booking fee. After verified fulfilment, the configured percentage commission is deducted from the agreed delivery price and the net amount is settled to the company. The offline provider receival fee does not also apply.

The fee rules, accounting entries, snapshots, idempotency, insufficient-balance policy, cancellation and refund rules are detailed in [SKIMA Logistics Financial Lifecycle](41-skima-logistics-financial-lifecycle.md).

## 8. Application and deployment structure

- New Expo app: `apps/logistics-mobile`.
- Keep `apps/lpg-mobile` as the existing SKIMA Commerce/LPG application.
- Reuse client-safe packages such as `@skima/frontend-core`, but do not import LPG business screens, providers or navigation into the logistics app.
- Use a unique app identity: scheme `skima-logistics`, Android package `com.skima.logistics`, iOS bundle identifier `com.skima.logistics`.
- Use the existing authenticated API gateway and a separate logistics route namespace (for example, `/logistics/*`) with server-side organisation checks.
- The existing SKIMA admin portal may expose a dedicated Logistics administration section; it must not mix provider-company controls with SKIMA's internal LPG/fuel operations.
- Deploy the logistics application independently from SKIMA LPG. Do not require the LPG app to be updated for the marketplace to launch.

## 9. Implementation sequence

1. Complete schema/RPC/RLS audit for organisations, staff, drivers, geography, generic service requests/quotes, wallet, ledger, escrow and financial policy governance.
2. Define the logistics module manifest, taxonomy and domain schema; add migration and security tests on a non-production target.
3. Implement company onboarding, verification, services, coverage and organisation-scoped staff access.
4. Implement customer job creation, provider matching, free opportunity/contact visibility, quotes and negotiation.
5. Implement booking confirmation and both financial lifecycles with immutable fee snapshots and idempotent postings.
6. Implement company dispatch, driver assignment, tracking, proof of delivery, cancellation and disputes.
7. Build the separate customer/company/driver app workspaces and platform administration.
8. Run regression gates for LPG, fuel, store and shared financial infrastructure before production rollout.

## 10. Release gates

The marketplace is not production-ready until tests prove:

- Customer A cannot read or modify Customer B's private job.
- Company A cannot see Company B's private company, staff, driver, financial or assigned-job records.
- A matched company sees the complete opportunity and permitted customer contact without paying an unlock fee.
- Viewing or quoting never charges the company.
- Exactly one booking can win a job.
- Offline confirmation posts exactly one customer booking fee and one provider receival fee.
- Online confirmation posts the customer booking fee and reserves the agreed delivery amount; fulfilment posts the configured commission once and settles the net amount.
- A failed, duplicated, cancelled or disputed event cannot create duplicate debits, credits, commission or settlement.
- An existing LPG, fuel or store workflow is unchanged.

