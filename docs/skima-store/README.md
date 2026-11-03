# SKIMA Store — implementation foundation

This workstream is independent of LPG, PMS, kerosene, and diesel operations. Store merchandise is a separate business module and must never be inferred from the LPG/fuel catalog.

## Product model

Reuse the existing organization-scoped catalogue (categories, items, variants, prices, media, availability), order engine, inventory reservations, and financial/settlement engines. Every first-party Store listing must carry `metadata.sales_channel = "skima_store"`; customer browsing also requires the active Store module, its configured operating organisation, an effective active price, and an active in-stock availability rule.

The migration provisions a dedicated first-party `SKIMA Store` operating organisation and active merchant profile. Its Storefront configuration starts in Draft and must be activated by a platform Store manager. Configuration stores the operating organisation, currency, default fulfilment method, and supported fulfilment methods. The user who configures Store receives an organisation-scoped Store operations role for reading and processing only those Store orders.

## Store listing requirements

- Customer title, description, category, variant/SKU where relevant, and product media.
- Selling price in the configured Store currency, with an optional higher compare-at price; discounts are calculated from those values, never stored as a client-authoritative amount.
- Draft/active state, effective price window, and real stock/availability must be respected before customer display.
- Store merchandise must be created through the Store admin action or deliberately tagged for the Store sales channel. LPG refill, PMS, diesel, and kerosene items are not automatically exposed in Store.
- Inventory is reserved by the shared order engine at order submission and consumed only at the Store fulfilment confirmation action. Cancellation releases the reservation.
- Store order lifecycle is configured as a module workflow: receive, accept, prepare, ready for pickup, fulfil, complete, with cancellation and reason handling.
- Store-specific fulfilment must not mutate LPG handoff verification, fuel dispatch, or the LPG/PMS/kerosene/diesel product toggles.

## Current branch slice

- Separate Store business module, workflow, acceptance policy, first-party merchant organisation, and draft storefront setting.
- Store settings and product creation endpoints use authenticated gateway routes and security-definer RPCs; direct client table writes remain blocked.
- Admin workspace: Store activation/configuration, product create/publish with price, discount price and stock, Store product list, order list and workflow actions.
- Customer app: Store tab, product browse/search/categories, variant selection, media rendering, persistent basket, and order request submission to the shared order engine.
- Customer checkout in this slice records an order request. It does not yet collect a delivery address, calculate delivery charges, capture payment, or automatically dispatch a driver. Those must be completed and tested before real customer orders are enabled.
- Product-image upload can use the existing catalogue media tooling; a dedicated Store image-upload flow remains a follow-up UI improvement.

## Delivery sequence

1. Store catalog projections and explicit listing administration.
2. Customer Store browsing, search, category filtering, product details and basket.
3. Delivery-address and delivery-eligibility capture; server-authoritative checkout, inventory reservation, payment, order lifecycle and fulfilment.
4. Promotions/campaign rules, returns/refunds, analytics, merchandising and dedicated image upload.

## Branch discipline

Base branch: `main`; initial base commit: `84ea6ccbbf7eac5182c7f3df49211a8e8fa03269`.

Before each development slice and PR merge, fetch current `main`, compare branch divergence, reconcile conflicts, and run relevant checks. Keep all Store code in `feat/skima-store-foundation-20261102`. Never merge Store work into `main` without review while LPG/fuel testing continues.

## Safety

Do not deploy migrations, Edge Functions, or mobile production builds from this branch without separate verification. No production migration has been applied by this workstream yet. Do not change existing LPG/fuel business rules in Store commits.
