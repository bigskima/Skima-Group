# Skima Group Platform — Financial Platform Specifications (Phase 12)

**Document Status:** Approved Implementation Specification & Active Execution Plan  
**Target Milestone:** Phase 12 — Skima Wallet Platform, Permanent Skima ID (`SKM-XXXXXXXX`), Internal P2P Transfers, Partner Verification Platform, Commerce Platform & Production EAS Deployment Pipeline  

---

## Executive Summary
Phase 12 establishes the single source of truth for all money within Skima. **Virtual Bank Accounts and NUBAN generation are completely excluded.** Skima is a wallet-first logistics, commerce, and payment platform, NOT a banking application. Every user receives a permanent public identifier (e.g. `SKM-12345678`), owns one Skima Wallet, and transfers money internally using Skima IDs with 0 gateway involvement. Money exits the platform exclusively through the controlled **Withdrawal Engine**.

---

## Phase 12 Blueprint — Key Platform Capability Directives

### 1. Skima Financial Platform & Wallet Engine (`FinancialPlatformEngine.ts`)
- **Core Engine:** `src/services/FinancialPlatformEngine.ts`
- **Database DDL:** `supabase/migrations/20260723030000_financial_platform_schema.sql`
- **Permanent Identifier:** Auto-generated permanent `skima_id` (`SKM-XXXXXXXX`) per profile for public search & internal P2P wallet transfers.
- **Wallet Balances:** Available, Locked, Pending, Lifetime Credits, Lifetime Debits, and Company Wallet for platform fees.
- **ZERO Virtual Accounts / NUBANs**: No user bank accounts managed by Skima.

---

### 2. Multi-Provider Infrastructure Connector (`PaymentAdapterEngine.ts`)
- **Core Service:** `src/services/PaymentAdapterEngine.ts`
- **Serverless Edge Function:** `supabase/functions/payment-settlement-webhook/index.ts`
- **Capability:** Infrastructure connectors for Paystack, Flutterwave, and Monnify strictly for funding and user withdrawal bank payouts. Zero business logic inside provider adapters.

---

### 3. Partner Verification Platform (`PartnerVerificationEngine.ts`)
- **Core Engine:** `src/services/PartnerVerificationEngine.ts`
- **Admin UI:** Enhanced `apps/admin/pages/verifications.tsx`
- **Capability:** Automated driver license OCR validation, NIN/BVN identity check, business CAC/TIN verification, and EPA safety clearance audits.

---

### 4. Commerce Platform (`CommerceEngine.ts`)
- **Core Engine:** `src/services/CommerceEngine.ts`
- **Capability:** Multi-vendor store listings, cart checkout, shipping distance fee math, escrow holds, returns, disputes, and merchant wallet settlement.

---

### 5. Production Mobile EAS & Web Deployment Pipeline
- **Mobile Build Config:** `apps/mobile/eas.json` (Android APK/AAB release builds & iOS TestFlight submission specs).
- **Web Admin Containerization:** `apps/admin/Dockerfile` & `vercel.json`.

---

### 6. Master Test Suite Expansion (Phase 12)
- **Test File:** `src/__tests__/engines.test.ts`
- **Capability:** 100% test coverage verifying `skimaId` generation, internal P2P wallet transfers, `FinancialPlatformEngine`, `PaymentAdapterEngine`, and deployment pipeline contracts.

---

## Master Checklist (Phase 12)

- [x] Create `20260723030000_financial_platform_schema.sql` (skima_id, wallets, company_wallet, withdrawal_requests, partner_verifications).
- [x] Build `FinancialPlatformEngine.ts` for internal P2P transfers using `SKM-XXXXXXXX` IDs & withdrawal holds.
- [x] Build `PaymentAdapterEngine.ts` & Edge Function `payment-settlement-webhook`.
- [x] Build `PartnerVerificationEngine.ts` & connect admin verifications UI (`verifications.tsx`).
- [x] Build `CommerceEngine.ts` for multi-vendor escrow settlement & order fulfillment.
- [x] Create production EAS config (`eas.json`) & Admin Docker containerization (`Dockerfile`).
- [x] Expand `src/__tests__/engines.test.ts` to cover Phase 12 capabilities and verify 100% test passage.



