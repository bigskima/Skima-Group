# SKIMA Store — implementation foundation

This workstream is independent of LPG, PMS, kerosene, and diesel operations.

## Product model
Reuse the existing organization-scoped catalog (categories, items, variants, prices, media, availability). Store merchandise must be explicitly tagged with `metadata.sales_channel = "skima_store"`; never automatically expose LPG or fuel catalog items as merchandise.

## Store listing requirements
- Item title, description, category, SKU/variant, media, currency-specific selling price, optional higher compare-at price, and calculated discount.
- Active status, valid price window, available stock, and a Store channel tag are required before customer display.
- Store-specific fulfillment and delivery policies must not mutate LPG handoff or fuel dispatch flows.
- Admin must be able to publish, pause, and archive listings. No fake inventory or placeholder price.
- Checkout must revalidate stock, price, customer scope, delivery eligibility, and payment before committing an order; client-side cart totals are not authoritative.

## Delivery sequence
1. Store catalog projections and explicit listing administration.
2. Customer Store browsing, search, category filtering, product details and cart.
3. Server-authoritative checkout, inventory reservation, order lifecycle, payments and fulfillment.
4. Promotions, discount campaigns, returns/refunds, analytics and merchandising.

## Branch discipline
Base branch: `main`; initial base commit: `84ea6ccbbf7eac5182c7f3df49211a8e8fa03269`.
Before each development slice and PR merge, fetch current `main`, compare branch divergence, reconcile conflicts, run relevant checks, and update this branch. Never merge Store work into `main` without review while fuel/LPG testing continues.

## Safety
Do not deploy migrations, edge functions, or mobile production builds from this branch without separate verification. Do not change existing LPG/fuel business rules in Store commits.
