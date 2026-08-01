# Milestone 3 Production Gate

Milestone 4 may not start until this checklist is complete.

Current status: Approved on 2026-07-30.

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
- [x] Full no-frontend LPG backend lifecycle passes through API/RPC calls after outbound webhook
      delivery is included.
- [x] `npm run supabase:backend:e2e` passes against the hosted Supabase dev project with signed
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
- [x] Updated webhook-aware no-frontend lifecycle gate passed with service request
      `723e675a-59fe-4eca-9fd0-87604a38d822`
- [x] Business onboarding lifecycle gate script exists and covers real applicant/admin API flow.
- [x] `npm run supabase:applications:e2e` passes against the hosted Supabase dev project after
      migration and API deployment.
- [x] Business onboarding lifecycle gate passed with application
      `df3b791e-ec31-40a3-bbdc-96b4155acb34`.
- [x] Driver and vehicle onboarding lifecycle gate passes without a frontend.
- [x] Driver and vehicle onboarding gate passed with driver application
      `c201ba01-6ae6-43ea-a47d-d805765b13cb`, vehicle application
      `06390d19-b1b3-4bb8-bf76-5e4592687719`, driver `95ee3d85-6240-4577-adce-15a6cfc102c7`, and
      vehicle `6271bfbc-7b30-4283-b347-9d42abfe05ce`.
- [x] Business staff invitation and branch-scoped permission gate passes without a frontend.
- [x] Organization staff lifecycle gate passed with organization
      `9bd3fb88-c009-4736-84a8-4db22c7d60a0`, branch `baff9c10-1999-4ae4-8ae8-c433b3505e8d`, staff
      user `319fbf81-196a-430c-840c-aff9c4c51b69`, and invitation
      `3aa9ea98-5958-48e4-8346-4483932c059e`.
- [x] Catalog, availability, stock/capacity, media linking, and orderability gate passes without a
      frontend.
- [x] Catalog availability lifecycle gate passed with organization
      `fe83fab6-21ea-456c-8346-400ac25da3d0`, branch `71e8bc2b-9b61-4433-853e-cdc6d410ab60`, item
      `1d61721f-27eb-40c2-9071-0cd05a69e388`, variant `0f4b8882-0ef4-4999-a64c-b0a5be219850`,
      availability rule `5d6e2429-d17b-441d-96b5-d59deeaecabb`, and orderability check
      `e758ada8-876e-43fc-9ff1-61256370ec6e`.
- [x] Order receiving/processing gate passes without a frontend.
- [x] Order operations lifecycle gate passed with order `f72eb9dd-66ed-49cf-a9e5-03895272d3f5`,
      service request `279cd8ba-4d0e-40bc-b902-567045edbac1`, organization
      `922d08db-0561-42fd-b1ad-730711c2eaed`, branch `8f09a507-b1a5-48b4-9b9d-78cf98303f35`, item
      `726d51d9-1a5f-46ef-95a1-40e5a84b84ae`, variant `63c6b029-d1cf-435e-9332-4525d459fe0b`, and
      availability rule `f21a68c2-a570-484e-995c-778075ff4aa7`.
- [x] Real NGN deposit, escrow, settlement, commission, withdrawal, and reconciliation gate passes
      without a frontend.
- [x] Communication and OTP gate passes without a frontend.
- [ ] Reviewer approves Milestone 3 evidence.

Latest finance/communication-backed module lifecycle evidence:

- order `a80de045-ee24-4e03-bd79-11898c9fe385`
- escrow hold `9ebc8534-d74b-441e-8497-225209cf6147`
- commission execution `90918e73-3399-4ade-a13d-f3b6a1790e0c`
- settlement statement `de906498-8f76-4954-b5a6-2490c9d6f25a`
