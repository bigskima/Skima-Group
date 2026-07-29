# API Reference

All API routes must be authenticated unless explicitly documented as public.

Public:

- `GET /functions/v1/health`

Authenticated current routes:

- `GET /functions/v1/api-gateway/health`
- `GET /functions/v1/api-gateway/engines/catalog`
- `GET /functions/v1/api-gateway/engines/currencies`
- `GET /functions/v1/api-gateway/engines/pricing-policies`
- `GET /functions/v1/api-gateway/engines/settlement-policies`
- `GET /functions/v1/api-gateway/engines/dispatch-policies`
- `GET /functions/v1/api-gateway/engines/verification-definitions`
- `GET /functions/v1/api-gateway/engines/notification-templates`
- `GET /functions/v1/api-gateway/engines/ai-task-definitions`
- `GET /functions/v1/api-gateway/engines/provider-adapters`
- `GET /functions/v1/api-gateway/modules/catalog`
- `GET|POST /functions/v1/api-gateway/modules`
- `GET|POST /functions/v1/api-gateway/modules/versions`
- `POST /functions/v1/api-gateway/modules/versions/activate`
- `GET|POST /functions/v1/api-gateway/modules/components`
- `GET /functions/v1/api-gateway/modules/events`
- `GET|POST /functions/v1/api-gateway/admin/role-templates`
- `GET|POST /functions/v1/api-gateway/admin/users`
- `POST /functions/v1/api-gateway/admin/users/revoke`
- `GET|POST /functions/v1/api-gateway/admin/webhook-endpoints`
- `GET /functions/v1/api-gateway/admin/webhook-deliveries`
- `GET /functions/v1/api-gateway/admin/webhook-attempts`
- `POST /functions/v1/api-gateway/admin/webhooks/queue`

Authenticated runtime routes:

- `GET /functions/v1/api-gateway/runtime/catalog`
- `GET /functions/v1/api-gateway/runtime/application-types`
- `GET|POST /functions/v1/api-gateway/runtime/applications`
- `POST /functions/v1/api-gateway/runtime/applications/payload`
- `POST /functions/v1/api-gateway/runtime/applications/submit`
- `POST /functions/v1/api-gateway/runtime/applications/reviewer`
- `POST /functions/v1/api-gateway/runtime/applications/corrections`
- `POST /functions/v1/api-gateway/runtime/applications/decisions`
- `POST /functions/v1/api-gateway/runtime/applications/withdraw`
- `GET /functions/v1/api-gateway/runtime/documents/requirements`
- `GET|POST /functions/v1/api-gateway/runtime/documents`
- `POST /functions/v1/api-gateway/runtime/documents/review`
- `GET /functions/v1/api-gateway/runtime/drivers`
- `GET /functions/v1/api-gateway/runtime/vehicles`
- `GET /functions/v1/api-gateway/runtime/driver-vehicle-links`
- `GET|POST /functions/v1/api-gateway/runtime/organization-branches`
- `GET|POST /functions/v1/api-gateway/runtime/organization-roles`
- `GET /functions/v1/api-gateway/runtime/organization-memberships`
- `GET /functions/v1/api-gateway/runtime/organization-user-roles`
- `GET|POST /functions/v1/api-gateway/runtime/organization-invitations`
- `POST /functions/v1/api-gateway/runtime/organization-invitations/accept`
- `POST /functions/v1/api-gateway/runtime/organization-staff/status`
- `POST /functions/v1/api-gateway/runtime/organization-staff/ownership-transfer`
- `GET /functions/v1/api-gateway/runtime/organization-staff/events`
- `GET|POST /functions/v1/api-gateway/runtime/catalog/units`
- `GET|POST /functions/v1/api-gateway/runtime/catalog/categories`
- `GET|POST /functions/v1/api-gateway/runtime/catalog/items`
- `GET|POST /functions/v1/api-gateway/runtime/catalog/variants`
- `GET|POST /functions/v1/api-gateway/runtime/catalog/prices`
- `GET|POST /functions/v1/api-gateway/runtime/catalog/media`
- `GET|POST /functions/v1/api-gateway/runtime/catalog/availability`
- `POST /functions/v1/api-gateway/runtime/catalog/stock-adjustments`
- `GET|POST /functions/v1/api-gateway/runtime/catalog/orderability`
- `GET /functions/v1/api-gateway/runtime/order-actions`
- `GET /functions/v1/api-gateway/runtime/order-acceptance-policies`
- `GET|POST /functions/v1/api-gateway/runtime/orders`
- `GET /functions/v1/api-gateway/runtime/orders/line-items`
- `POST /functions/v1/api-gateway/runtime/orders/actions`
- `GET|POST /functions/v1/api-gateway/runtime/orders/assignments`
- `GET /functions/v1/api-gateway/runtime/orders/events`
- `GET|POST /functions/v1/api-gateway/runtime/service-requests`
- `GET|POST /functions/v1/api-gateway/runtime/pricing/quotes`
- `POST /functions/v1/api-gateway/runtime/pricing/quotes/accept`
- `POST /functions/v1/api-gateway/runtime/payments/reserve`
- `POST /functions/v1/api-gateway/runtime/workflows/start`
- `POST /functions/v1/api-gateway/runtime/events/process`
- `POST /functions/v1/api-gateway/runtime/participants/assign`
- `POST /functions/v1/api-gateway/runtime/dispatch/select`
- `POST /functions/v1/api-gateway/runtime/tracking/sessions`
- `POST /functions/v1/api-gateway/runtime/tracking/points`
- `POST /functions/v1/api-gateway/runtime/verifications`
- `POST /functions/v1/api-gateway/runtime/notifications/queue`
- `POST /functions/v1/api-gateway/runtime/ai/queue`
- `POST /functions/v1/api-gateway/runtime/settlements/execute`
- `POST /functions/v1/api-gateway/runtime/escrow/status`
- `POST /functions/v1/api-gateway/runtime/escrow/release`
- `POST /functions/v1/api-gateway/runtime/escrow/refund`
- `POST /functions/v1/api-gateway/runtime/reconciliation/service-request`
- `GET|POST /functions/v1/api-gateway/runtime/payments/deposits`
- `POST /functions/v1/api-gateway/runtime/payments/deposits/verify`
- `GET /functions/v1/api-gateway/runtime/payment-webhook-events`
- `GET /functions/v1/api-gateway/runtime/wallets`
- `GET /functions/v1/api-gateway/runtime/wallet-balances`
- `GET|POST /functions/v1/api-gateway/runtime/withdrawal-beneficiaries`
- `GET|POST /functions/v1/api-gateway/runtime/withdrawals`
- `POST /functions/v1/api-gateway/runtime/withdrawals/approve`
- `POST /functions/v1/api-gateway/runtime/withdrawals/transfers`
- `POST /functions/v1/api-gateway/runtime/order-funding`
- `POST /functions/v1/api-gateway/runtime/commissions/execute`
- `GET /functions/v1/api-gateway/runtime/commission-executions`
- `POST /functions/v1/api-gateway/runtime/order-settlements/execute`
- `GET /functions/v1/api-gateway/runtime/settlement-statements`
- `GET|POST /functions/v1/api-gateway/runtime/communications/messages`
- `POST /functions/v1/api-gateway/runtime/communications/sync`
- `GET|POST /functions/v1/api-gateway/runtime/otp/challenges`
- `POST /functions/v1/api-gateway/runtime/otp/verify`

Worker and webhook surfaces:

- `POST /functions/v1/runtime-worker` requires `x-skima-worker-secret`
- `POST /functions/v1/payment-webhook` requires `x-skima-webhook-secret` and processes signed
  deposit provider events through the payment adapter runtime
- `POST /functions/v1/webhook-sandbox-receiver` requires a valid `x-skima-signature`

All authenticated API routes enforce the configured database rate-limit policy
`api.gateway.authenticated.default`.

Every current finance and communication route is backed by database RPCs or worker processing with
validation, idempotency, RLS/permission checks, append-only operational receipts, provider execution
logs, and hosted no-frontend gate coverage. Live vendor endpoints are enabled later by changing
provider adapter configuration and Supabase secrets, not by changing business modules.
