# Skima LPG Admin App

The admin app is the current Milestone 4 operations frontend for Skima LPG. It may keep reusable operations primitives, but the launch admin experience should focus on the LPG business rather than unrelated service categories. The app consumes
the approved Supabase backend through:

- Supabase browser sessions
- `/functions/v1/api-gateway/runtime/session-context`
- the shared API gateway client in `packages/frontend-core`
- the reusable UI system in `packages/ui`

Current LPG operations capabilities built on shared platform engines:

- authenticated Supabase sign-in and sign-out
- backend-driven session context, roles, organizations, and permissions
- permission-aware navigation
- operations overview
- user profile listing and account status changes
- application and document review queue
- reviewer assignment
- application correction requests
- application approval and rejection
- document approval, rejection, and correction requests
- admin role template configuration
- platform admin assignment and revocation
- LPG business line, version, component, and activation configuration
- webhook endpoint creation and delivery queueing
- organization branch, staff role, staff invitation, access status, and ownership controls
- LPG catalog unit, category, item, variant, price, media, availability, stock, and orderability
  controls
- order creation, order actions, participant assignment, service requests, pricing, workflow events,
  dispatch, tracking, verification, notifications, and AI task queueing
- wallet deposit, deposit verification, beneficiary setup, withdrawal request/approval, transfer
  outcome recording, escrow release/refund, settlement, commission, and reconciliation actions
- provider, policy, communication, OTP, webhook delivery, and payment event visibility

Company-adjustable financial policy must use the controlled lifecycle in the
[Financial Policy Governance Directive](../../docs/32-financial-policy-governance-directive.md):
authorized authoring, approval where required, versioning, effective dates, scoped activation,
history, auditability, and safe rollback. The finance action console is not a substitute for that
policy-management workspace, and admin-entered monetary values must never become authoritative
when a backend policy can derive them.

Every write action goes through the authenticated gateway and backend policy/RLS/RPC layer. The UI
does not create direct table writes or become a financial source of truth.

Client env values must be Vite-prefixed and client-safe:

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

For local development, the existing safe `SUPABASE_URL` and `SUPABASE_ANON_KEY` names are also
accepted.

No service-role key, database password, provider secret, webhook secret, Paystack key, Gemini key,
or admin credential belongs in this app.

Run after dependencies are installed:

```bash
npm run frontend:check
npm run frontend:test
npm run frontend:build
```
