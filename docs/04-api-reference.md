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

Authenticated runtime routes:

- `GET /functions/v1/api-gateway/runtime/catalog`
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

Worker and webhook surfaces:

- `POST /functions/v1/runtime-worker` requires `x-skima-worker-secret`
- `POST /functions/v1/payment-webhook` requires `x-skima-webhook-secret`

All authenticated API routes enforce the configured database rate-limit policy
`api.gateway.authenticated.default`.
