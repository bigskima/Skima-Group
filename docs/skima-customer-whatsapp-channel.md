# SKIMA LPG customer WhatsApp channel

## Scope
This is a customer-only WhatsApp Business Cloud API channel. It must reuse SKIMA's canonical profile, LPG quote/order, wallet, payment, ledger and tracking systems. It must not introduce station/driver workflows, a parallel wallet, hard-coded pricing, or independent order settlement.

## Environment
Configure these Supabase Edge Function secrets only after the Meta WhatsApp Business account and phone number are approved:

- `SKIMA_WHATSAPP_VERIFY_TOKEN`: random webhook verification token.
- `SKIMA_WHATSAPP_APP_SECRET`: Meta app secret used to validate `X-Hub-Signature-256`.
- `SKIMA_WHATSAPP_ACCESS_TOKEN`: server-side Meta Cloud API token.
- `SKIMA_WHATSAPP_PHONE_NUMBER_ID`: Meta phone number ID, not the public phone number.
- `SKIMA_WHATSAPP_GRAPH_API_VERSION`: currently supported Graph API version (for example `vXX.0`; use the version approved for the Meta app).
- Standard `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided by Supabase.

Do not commit any secret to GitHub or the app bundle. Do not enable external delivery until the Meta account, template policy, webhook signature, and customer consent are checked.

## Current implementation stage
The webhook verifies Meta's GET subscription challenge and POST signature, persists inbound messages idempotently, and sends a customer-only menu. It deliberately does not yet execute account, wallet, order or payment mutations. Those must be connected through authenticated channel-specific backend operations before production use; the current provider-selection policy remains unchanged and external delivery remains disabled.

## Required next implementation
1. Add secure account linking: customer initiates in the authenticated SKIMA app, gets a short-lived one-time code, and completes the link by sending that code to the official WhatsApp number. Store only a hash, enforce expiry/attempt limits, and never auto-link by phone string alone.
2. Build channel-neutral, database-authoritative customer operations for cylinder/location selection, real quotes, order confirmation, wallet deposits, verified payment callbacks and order status. Preserve idempotency and the existing ledger/reservation/settlement lifecycle.
3. Test sandbox fixtures and security-negative cases before configuring live Meta credentials or deploying customer-facing delivery.
