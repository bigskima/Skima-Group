# SKIMA GROUP: MASTER SYSTEM BLUEPRINT & ENGINEERING SPECIFICATION

**Version:** 2.0  
**Status:** Production Architectural Specification & Single Source of Truth  
**Target Platform:** Skima Operating System for Commerce and Logistics  

---

# 1. FOUNDER & OPERATIONS GUIDE (THE CONSTITUTION OF SKIMA)

## 1.1 Introduction & Platform Identity
Skima is not a delivery application.  
Skima is not an online shop.  
Skima is not a wallet.  
Skima is not a marketplace.  

Skima is a **Technology Platform** that connects people, businesses, logistics, and payments through one trusted operating system. Instead of allowing every participant to negotiate independently, Skima coordinates everything.

- The platform owns the workflow.
- The platform verifies every action.
- The platform controls settlement.
- The platform builds trust through verification instead of assumptions.

**Think of Skima as an Operating System for Commerce and Logistics.**

---

## 1.2 The Skima Philosophy
People should only perform the job they are responsible for:
- **Customers** should buy.
- **Drivers** should deliver.
- **Stations** should refill.
- **Merchants** should sell.
- **Admins** should manage.

The system coordinates everyone. Nobody performs another person's responsibility. This separation makes the platform secure, scalable, and easy to operate.

---

## 1.3 One Platform Principle
Skima consists of:
- **ONE** Mobile Application (React Native / Expo / TypeScript)
- **ONE** Backend (Supabase Platform)
- **ONE** Admin Control Center (Web Operations Portal)
- **ONE** User Identity (Unified Profile with Permission-Based Role Unlocking)

Users unlock additional roles after verification. One person may simultaneously operate as Customer, Driver, or Merchant within the exact same account.

---

# 2. AI IN SKIMA ARCHITECTURE (THE 10 SPECIALIZED AI AGENTS)

## 2.1 What is AI's Role?
AI is not the brain of Skima. **Skima is the brain.**  
AI is a collection of intelligent specialized assistants (powered by Google Gemini) that help Skima make better decisions, automate repetitive tasks, and improve user experience.

---

## 2.2 The 10 Specialized AI Agents

### Agent 1 — Dispatch Intelligence
Ranks stations and drivers using multi-factor optimization (queue length, station availability, Awka traffic, cylinder count) instead of simple "nearest station" logic.

### Agent 2 — Customer Support Assistant
Gemini-powered 24/7 first responder for FAQs, order status, wrong cylinder selection, role registration, and automatic escalation to human admins.

### Agent 3 — Merchant Product Assistant
Transforms raw merchant listings (e.g. "12kg cooking gas") into professional title, description, category, and keyword metadata.

### Agent 4 — Fraud Detection Agent
Monitors pattern anomalies (e.g. driver completing deliveries in 2 minutes, station volume doubling overnight, rapid failed wallet deposits) and flags alerts for Admin review.

### Agent 5 — Operations Query Assistant
Translates natural language admin requests (e.g. "Show today's failed wallet transactions", "Which station completed the most orders this week?") into structured database analytics queries.

### Agent 6 — Content & Announcement Assistant
Drafts clear, professional announcements, maintenance notices, driver updates, and holiday promotion notifications for admin review.

### Agent 7 — Address & Landmark Intelligence
Parses Nigerian human landmark descriptions (e.g. *"Behind Emma Pharmacy"*, *"Opposite Aroma Junction"*, *"Close to UNIZIK Temporary Site"*) into structured location metadata.

### Agent 8 — Order Timeline Summarizer
Converts raw operational log timestamps into clean, human-friendly summary statements for customers.

### Agent 9 — Executive Analytics Assistant
Interprets revenue trends, order volume shifts, and merchant growth metrics into plain business insights for company leadership.

### Agent 10 — Internal Knowledge Assistant
Provides instant documentation, API handling, and workflow answers for engineers, QA teams, and support staff.

---

## 2.3 AI Safety & Boundaries
AI **never** makes irreversible financial or security decisions on its own. Gemini may recommend or assist, but cannot independently:
- Release escrow funds.
- Approve merchant, driver, or station verification.
- Reverse completed financial transactions.
- Modify user permissions or system configuration.

---

# 3. THE 4 MASTER PRODUCTION BUILDING PHASES

```
 ┌────────────────────────────────────────────────────────────────────────┐
 │ PHASE 1: SOVEREIGN DATABASE KERNEL & SECURITY CORE                     │
 │ - PostgreSQL Database DDL (Profiles, Wallets, Ledger, Cylinders, Orders)│
 │ - Row Level Security (RLS) & Triggers (handle_new_user)                │
 │ - Atomic Double-Entry Stored Procedures (fund_user_wallet, lock_escrow)│
 │ - Supabase Auth Engine & Edge Functions (auth-signup, auth-login)      │
 └───────────────────────────────────┬────────────────────────────────────┘
                                     │
 ┌───────────────────────────────────▼────────────────────────────────────┐
 │ PHASE 2: PLATFORM ENGINES, LEGO UI & 10 AI AGENTS                      │
 │ - Double-Entry Wallet & Escrow Ledger Engine                           │
 │ - Payment Gateway Adapter Engine (Paystack, Flutterwave, Monnify)      │
 │ - Physical Cylinder QR Custody Engine & Awka Address Geofencing        │
 │ - Reusable LEGO UI Components & Hooks (AppButton, AppInput, BaseCard)  │
 │ - 10 Specialized AI Gemini Agents (Dispatch, Fraud, Support, Address) │
 └───────────────────────────────────┬────────────────────────────────────┘
                                     │
 ┌───────────────────────────────────▼────────────────────────────────────┐
 │ PHASE 3: PRODUCTION MODULES & SINGLE MOBILE APP SUITE                  │
 │ - Single Mobile App Role Screens (Customer, Driver, Station, Merchant) │
 │ - Gas Refill Ordering, QR Custody Handshake & Realtime Tracking Map    │
 │ - Marketplace Merchant Storefront, Product Catalog & Inventory Console │
 │ - Utility Bill Payments (Airtime, Data, Electricity, Cable TV)         │
 └───────────────────────────────────┬────────────────────────────────────┘
                                     │
 ┌───────────────────────────────────▼────────────────────────────────────┐
 │ PHASE 4: ADMIN CONTROL CENTER & SYSTEM DEPLOYMENT                      │
 │ - Admin Governance Web Portal (Gas Price per kg, Awka Zone Polygon)    │
 │ - Driver/Merchant KYC Verification & AI Fraud Detection Alerts         │
 │ - Production Supabase & Expo EAS Deployment Pipeline                   │
 └────────────────────────────────────────────────────────────────────────┘
```
