# Milestone 3 Production Gate

Milestone 4 may not start until this checklist is complete.

Current status: In Progress.

## Scope

Milestone 3 builds the reusable Business Module Framework. It must not hardcode LPG, restaurant,
ride hailing, pharmacy, or any other business module into platform engines.

## Local Verification

- [x] Shared module TypeScript contracts compile with Deno.
- [x] Static validation confirms business module registry tables have RLS.
- [x] Static validation confirms module lifecycle events are append-only.
- [x] Static validation confirms direct authenticated module framework inserts are rejected by RLS.
- [x] Static validation confirms module activation requires configured components.
- [x] Static validation confirms module configuration functions exist.

## Remote Supabase Verification

- [x] Module framework migration applies to the hosted Supabase dev project.
- [x] API gateway deploys with authenticated module framework routes.
- [x] Remote gate confirms anonymous users cannot access module gateway routes.
- [x] Remote gate confirms service-role access to module framework tables.
- [x] Remote gate confirms incomplete module framework operations are rejected by the module
      engines.
- [x] Remote gate confirms the platform super admin can read module framework records.
- [x] LPG module configuration migration applies to the hosted Supabase dev project.
- [x] Remote gate confirms active LPG module version 1 has required engine component bindings.
- [x] Remote gate confirms the platform super admin can read active LPG module records.
- [ ] Full no-frontend LPG backend lifecycle passes through API/RPC calls after outbound webhook
      delivery is included.
- [ ] `npm run supabase:backend:e2e` passes against the hosted Supabase dev project with signed
      outbound webhook delivery evidence.
- [ ] Reviewer approves lifecycle evidence.

## Framework Checklist

- [x] Module registry
- [x] Module versioning
- [x] Module component binding model
- [x] Dispatch policy component binding type
- [x] Module lifecycle event receipts
- [x] Module admin role template
- [x] Module configuration RPCs
- [x] Module activation validation
- [x] API gateway module routes
- [x] First business module configuration
- [x] No-frontend lifecycle gate script
- [x] Earlier no-frontend lifecycle gate passed with service request
      `f126afbf-2cbe-4b46-bd79-5d82531c20e1`
- [ ] Updated webhook-aware no-frontend lifecycle gate passed with service request evidence
