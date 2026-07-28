# Milestone 4 Production Gate

Milestone 4 builds the reusable frontend foundation. It must not create isolated business screens or
hardcode LPG behavior into UI code.

Current status: In Progress.

## Scope

Milestone 4 must deliver reusable frontend primitives and API integration patterns that can support
admin, customer, partner, driver, and future module experiences without rewriting the frontend
foundation.

Required foundation:

- application shell
- routing layout
- design tokens
- reusable buttons, inputs, forms, dialogs, tables, lists, navigation, loading states, and error
  states
- Supabase client initialization using only client-safe env values
- authenticated session provider
- API gateway client
- typed runtime response handling
- reusable permission-aware navigation model
- no business-specific screens until primitives and integration contracts exist

## Entry Evidence

- [x] Milestone 1 is complete enough for frontend foundation work on the hosted dev project.
- [x] Milestone 2 runtime engines are complete.
- [x] Milestone 3 module framework and webhook-aware lifecycle gate are complete.
- [x] Supabase Free-plan PITR and Log Drains limitations are documented as production-launch
      hardening items, not frontend-build blockers.

## Completion Gate

- [ ] Frontend app package exists with a production-capable build command.
- [ ] Design system primitives exist and are reusable.
- [ ] Supabase URL and anon key are the only client-side Supabase env values.
- [ ] Authentication state is implemented through Supabase client sessions.
- [ ] API calls go through a reusable gateway client.
- [ ] Route guards are permission-aware and backend-driven.
- [ ] Loading, empty, and error states are reusable.
- [ ] No LPG-only UI logic exists in the frontend foundation.
- [ ] `npm run verify` passes.
- [ ] Frontend build passes.
- [ ] Documentation is updated.
- [ ] Reviewer approves Milestone 4 evidence.
