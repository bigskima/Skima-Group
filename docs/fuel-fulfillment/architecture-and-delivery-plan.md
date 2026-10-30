# SKIMA Fuel Fulfilment: Architecture and Delivery Plan

## Purpose

Extend SKIMA's existing platform with a single data-driven Fuel business module supporting three independently managed products:

- PMS — petrol
- AGO — diesel
- DPK — kerosene

This is an extension of SKIMA, not a separate logistics platform, app, customer account system, station onboarding process, driver onboarding process, wallet, payment service or dispatch engine.

The existing LPG module remains intact and continues to use its cylinder collection, station refill and cylinder return journey. Fuel uses a distinct station-fill and container-delivery journey.

## Product and service boundaries

- Business module key: `fuel`.
- Canonical product keys: `fuel.pms`, `fuel.ago`, `fuel.dpk`.
- Canonical selling unit: litre (`L`), with quantity precision controlled centrally.
- Global product status is independent for PMS, AGO and DPK.
- Branch-level offering, price, availability, storage capacity and stock are independent from global product status.
- A product is orderable only when its global status, branch offering, branch stock, coverage, price, container compatibility and fulfilment eligibility all allow the requested order.

A global pause prevents new orders for that product but does not cancel, rewrite or interrupt an already accepted order. Pausing one branch's offering does not pause the product at other branches.

## Fulfilment journeys

### LPG (preserve)

Customer cylinder → driver pickup → station refill → driver return → customer delivery/verification → existing LPG settlement.

No LPG cylinder tables, routes, state machines, screens, policies or settlement rules are to be renamed or repurposed for fuel.

### Fuel with customer-owned container

1. Customer chooses PMS, AGO or DPK and a requested quantity in litres.
2. Backend identifies an eligible branch, validates stock and container compatibility/capacity, and calculates an itemised quote.
3. Customer selects container purchase; container purchase cost is included in the locked quote.
4. Customer pays through SKIMA's existing wallet/payment/escrow infrastructure.
5. Station reserves stock and container, fills the container and records the measured filled quantity.
6. Existing driver/vehicle identity and dispatch infrastructure assigns an eligible delivery driver.
7. Driver verifies station handover, delivers the container, and customer confirms delivery/quantity.
8. Container ownership is transferred to the customer after the defined handover and payment conditions are satisfied. The purchased container is not expected to return.

### Fuel with SKIMA rental container

1. Customer chooses the same fuel and quantity.
2. Customer chooses rental rather than purchase; the quote includes rental charge and any configured refundable deposit as a separate liability, not platform revenue.
3. SKIMA-owned container(s) are reserved for the order and linked to the order before station preparation.
4. Station reserves fuel stock, fills the compatible container(s), records quantity and hands custody to the assigned driver.
5. Driver delivers the fuel. Delivery and customer confirmation are recorded independently from container-return completion.
6. Customer transfers the fuel and hands the empty rental container(s) to the driver.
7. Driver records return handover. The station confirms receipt and inspects the container(s).
8. Only after receipt and successful inspection does the container become available for reuse and any eligible refundable deposit become refundable/releasable.
9. Missing, damaged, late or disputed rental containers remain in an exception/collection workflow; they must not silently become available or cause premature order closure.

A normal return is expected during the delivery visit. The data model must nevertheless support a return-pending state and a separate collection task if same-visit return does not occur.

One order may require multiple containers. Allocation must cover the requested litres within each container's configured capacity and product compatibility. Do not assume one order equals one container.

## Reusable platform foundations

Reuse existing profiles, organizations, branches, partner/station records, driver identities, vehicle records, capability framework, generic service/order/workflow engines, participant assignment, dispatch, tracking, verification, notifications, wallet, ledger, escrow and financial settlement.

Reuse the existing `assets` registry as the physical asset identity and ownership anchor for containers. It currently supports an asset type key, organization/user ownership, status, metadata, audit triggers and entity capabilities. Add structured fuel-container profile, allocation/reservation and append-only custody records; do not treat generic asset metadata as the entire rental workflow.

Reuse the existing catalog, variants, unit, prices, availability and orderability engine where valid. Add a product-level global switch because branch catalogue availability alone cannot implement a platform-wide per-product switch.

## New fuel-specific foundations

### Product configuration

A central product registry defines the three canonical product keys, litre unit, display information, default workflow profile and independently controlled global status. The customer app and admin UI read this configuration; product names, availability and toggles must not be hardcoded in screens.

### Branch inventory

Fuel storage and stock must be branch-based and unit-aware. Record storage units/tanks, compatible product, safe capacity, physical stock, reserved quantity, available quantity, stock receipts, adjustments, dispenses, reconciliation and append-only stock movements.

The existing LPG station inventory schema is tied to LPG station branches, LPG orders, LPG tanks and kilograms. Do not rename kilograms to litres, point petrol inventory at LPG tank rows, or change existing LPG inventory foreign keys. The fuel inventory model must be its own liquid-fuel layer linked to generic organization branches and fuel product definitions.

### Container operations

Use the common asset ID and add typed fuel-container attributes such as serial/QR identity, container type, nominal capacity in litres, supported product keys, inspection state and operational status. Model order allocation separately from asset ownership. Record every custody transfer (station → driver → customer and, for rentals, customer → driver → station), including actor, timestamp, order, verification/evidence and outcome.

Purchased containers become customer-owned at the correct confirmed handover point. Rental containers remain SKIMA-owned throughout. A container can have only one active reservation/allocation at a time.

### Commercial quote and settlement

The backend creates an immutable, idempotent pricing snapshot containing fuel quantity and price, container purchase or rental charge, optional refundable deposit, driver/delivery fee, platform fee and other configured charges/taxes. Client-provided totals are never trusted.

Escrow and settlement reuse existing financial engines. The snapshot must distinguish station proceeds, driver compensation, platform revenue, container-sale proceeds, rental charges and refundable rental liabilities. A deposit must not be classified as revenue. Cancellation, partial fulfilment, delivered-quantity variance, refund, lost container and damage deductions must use explicit financial adjustment/reconciliation records.

### Dispatch and safety eligibility

Do not infer fuel eligibility from LPG cylinder-handling capability. Fuel driver, vehicle and container eligibility is product- and configuration-aware. Assignment, station handover and delivery must check the currently active eligibility and compatible capacity. Regulatory and operational requirements must be reviewed and configured before a product or branch is enabled for live operations.

## Frontend integration requirements

All roles use the existing SKIMA application and existing identities.

- Customer: fuel discovery, product status, litre quantity, container purchase/rental selection, full quote, payment, order progress, delivery verification and rental-return status.
- Station: per-product branch configuration, stock/tank management, order acceptance, stock/container reservation, filling confirmation and driver handover/return inspection.
- Driver: eligible fuel job list, station navigation, filled-container pickup, delivery proof and rental-container return custody.
- Admin: global PMS/AGO/DPK switches, branch offers, pricing, stock oversight, container catalogue/ownership, rental rules, fees, coverage, dispatch eligibility and exception resolution.

The LPG screens and endpoints remain compatible. New fuel screens and domain APIs use the generic runtime plus explicit fuel operations; they do not fake a fuel order by posting to LPG refill routes.

## Delivery phases and gates

1. **Baseline and migration reconciliation** — establish branch from current main; restore the production-applied migration missing from main; validate the repository history policy against the live ledger; inspect schema/functions used by the new module.
2. **Fuel product/module registry** — introduce the fuel module and three disabled-by-default product controls; add permissioned admin control and data-driven reads.
3. **Fuel stock and container schema** — add litre-based branch storage/inventory, container profiles, reservations, allocations and custody events with RLS, constraints, idempotency and indexes.
4. **Commercial quote and orders** — build server-authoritative pricing snapshots, product-aware orderability, stock/container reservation and escrow funding.
5. **Station and driver operations** — station fill/handover, shared driver dispatch with product-specific eligibility, customer delivery, rental return and exception handling.
6. **Customer and role workspaces** — integrate customer, station, driver and admin UI against the real APIs and workflows; no disconnected mock screens.
7. **Financial finalization** — settlement, container ownership transfer, rental liabilities/refunds, cancellations, partial fulfilment and reconciliation.
8. **Verification and rollout readiness** — execute three-product lifecycle tests and negative/concurrency tests; run LPG regression suites; inspect security/performance advisors; only then prepare a deployment plan.

## Non-negotiable acceptance tests

- Each of PMS, AGO and DPK can be enabled/paused independently at platform level and enabled/paused independently per branch.
- A paused product or unavailable branch cannot accept new orders; in-progress orders remain safely processable.
- Stock and container reservations are atomic under concurrent orders; no negative available stock or double-booked container.
- Customer purchase and SKIMA rental journeys both complete for each product.
- Purchased containers transfer ownership only after verified delivery; rental containers remain SKIMA-owned and cannot be reused before return and inspection.
- A multi-container order is fully supported and every container has individual capacity and custody records.
- Fuel orders never call LPG cylinder/pickup/refill endpoints or use kilogram/LPG inventory fields.
- Quotes and settlements reconcile exactly; deposits remain refundable liabilities; no client-controlled totals.
- Failed payment, cancellation, stockout, no driver, driver reassignment, delivery variance, missed return, damaged/lost container and duplicate requests are covered.
- Customer, station, driver and admin interfaces all use the same persisted order lifecycle.
- Existing LPG order, station-managed, SKIMA-managed, independent-driver, cylinder and settlement tests continue to pass.

## Deployment constraints

This feature branch is isolated from `main`. Do not apply migrations to production or deploy Edge Functions as part of branch development. Do not create a billable Supabase development branch or paid provider dependency without checking cost first. The verified production migration head is recorded separately from any new pending migration files.
