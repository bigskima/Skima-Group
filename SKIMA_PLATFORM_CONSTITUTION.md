# SKIMA PLATFORM CONSTITUTION v1.0

Universal AI-First Logistics, Commerce, Mobility, and Fulfillment Operating System

---

## 1. Project Vision

### Mission

Build Skima as a universal, modular, AI-first platform capable of supporting any logistics,
commerce, mobility, or fulfillment business without rebuilding the platform.

LPG is only the first service module.

The platform itself must never be designed around LPG. Instead, the platform must be capable of
supporting:

- LPG
- Food delivery
- Grocery
- Pharmacy
- Ride hailing
- Courier
- Laundry
- Furniture delivery
- Construction materials
- Water delivery
- Medical logistics
- Future businesses that do not yet exist

without changing the core architecture.

---

## 2. Platform Philosophy

Build the platform once. Extend forever. Never rebuild.

Everything must be:

- Modular
- Configurable
- Reusable
- Event driven
- Workflow driven
- Policy driven
- Database driven
- API first
- AI ready

---

## 3. Non-Negotiable Rules

Every AI agent must obey these rules.

### Rule 1

Never hardcode business logic.

### Rule 2

The platform never knows whether it is serving LPG, restaurant, pharmacy, or ride hailing. Only
modules know that.

### Rule 3

Businesses plug into the platform. They never modify the platform.

### Rule 4

Everything must be reusable. Never duplicate code.

### Rule 5

Everything must be configuration driven, not source-code driven.

### Rule 6

Every workflow must be stored in the database. Never inside business logic.

### Rule 7

If a new business requires modifying platform engines, the architecture has failed. Stop. Redesign.

---

## 4. Platform Layers

1. Identity
2. Organizations
3. Reusable platform engines
4. Workflow engine
5. Business modules
6. Reusable frontend
7. Artificial intelligence

---

## 5. Milestone 1: Platform Foundation

No LPG. No restaurants. No rides. No businesses. Only reusable platform foundation.

Build:

- Authentication Engine
- Authorization Engine
- User Engine
- Role Engine
- Permission Engine
- Partner Engine
- Driver Engine
- Vehicle Engine
- Asset Engine
- Organization Engine
- Media Engine
- Storage Engine
- Configuration Engine
- Audit Engine
- Logging Engine
- Error Engine
- Queue Engine
- Background Jobs
- Webhooks
- API Gateway
- Rate Limiting
- Caching
- Database
- Edge Functions
- Security
- Health Monitoring
- Documentation

Everything must be reusable.

### Technology Stack

The stack must be replaceable through adapters:

- Backend framework with structured architecture
- PostgreSQL
- Redis
- Object storage
- REST APIs
- GraphQL, optional
- Background queue
- JWT/OAuth authentication
- Containerization
- Monitoring

The architecture must isolate providers behind adapters so they can be replaced later.

---

## 6. Milestone 2: Reusable Platform Engines

Build engines, not businesses.

### Driver Engine

Supports:

- Driver profiles
- Verification
- Capabilities
- Vehicle types
- Vehicle capacity
- Weight limits
- Cargo types
- Ratings
- Availability
- Working hours
- Zones
- Documents
- Licenses
- Performance
- Restrictions

The engine must never assume that a driver only delivers one type of service. A driver may be
approved for one or many service categories depending on capabilities.

### Vehicle Engine

Supports:

- Motorcycle
- Tricycle
- Car
- Pickup
- Mini truck
- Truck
- Van
- Electric vehicle
- Future vehicles

Vehicles define capabilities, not businesses.

### Partner Engine

Supports:

- Restaurant
- Gas station
- Pharmacy
- Laundry
- Warehouse
- Courier company
- Store
- Marketplace
- Unknown businesses

Partner behavior comes from configuration.

### Pricing Engine

Supports:

- Fixed pricing
- Distance pricing
- Weight pricing
- Time pricing
- Dynamic pricing
- Negotiated pricing
- Quoted pricing
- Marketplace pricing
- Subscription pricing
- Hybrid pricing
- AI assisted pricing
- Manual pricing

Businesses choose pricing policies. The engine does not.

### Settlement Engine

Supports multiple settlement policies, including:

- Customer -> Escrow -> Station -> Driver commission
- Customer -> Escrow -> Driver
- Customer -> Escrow -> Restaurant -> Driver commission
- Customer -> Business -> Platform fee
- Customer -> Escrow -> Multiple beneficiaries

No settlement policy is hardcoded.

### Wallet Engine

Supports:

- Customer Wallet
- Driver Wallet
- Partner Wallet
- Platform Wallet
- Escrow Wallet
- Commission Wallet
- Refund Wallet
- Bonus Wallet
- Loyalty Wallet

Every wallet is ledger based. Every transaction is traceable.

### Financial Engine

This engine controls all financial movement across the platform.

Financial rules:

- No payment goes directly from customer to business.
- No payment goes directly to drivers.
- Every payment enters the platform financial gateway first.

The Financial Engine decides:

- Where money goes
- How long it is held
- When it is released
- Who receives commissions
- Who receives platform fees
- Who receives refunds

### Financial Policy Governance

Every company-adjustable financial rule must be managed as an authorized, versioned, auditable
backend policy. The Admin Dashboard is the controlled management surface; it is never a financial
source of truth and must not calculate authoritative amounts. Pricing, commission, payout,
settlement, fee, discount, refund, and adjustment policies must be configuration-driven, scoped,
effective-dated, and protected by RBAC and approval controls where appropriate.

Missing, invalid, inactive, unapproved, or ambiguous policy configuration must fail closed for the
affected financial operation. A zero amount is valid only when explicitly authorized by policy; it
must never be an implicit fallback.

An accepted quote, order, or other active financial obligation must retain its policy/version and
financial snapshot. Later policy changes apply only to future work according to their effective time
and scope, and never mutate historical ledger records or silently change an existing obligation.

Partners may manage only financial settings explicitly delegated to their own scope. Customers and
drivers never control authoritative financial policy or monetary amounts.

This engine works with:

- Settlement Engine
- Escrow Engine
- Wallet Engine
- Policy Engine

### Currency Engine

The platform must support multiple currencies.

Only one currency is enabled during Phase One:

- NGN

Future expansion must allow the Admin Dashboard to enable USD, USDC, EUR, GBP, and future currencies
without changing backend code.

Currencies are enabled through configuration, not development.

### Payment Provider Engine

Never hardcode one payment provider. Build a provider adapter.

Examples:

- Local payment gateways
- Card processors
- Bank transfers
- Future digital asset providers

The platform communicates only with the adapter.

### Escrow Engine

Supports:

- Temporary holding
- Conditional release
- Multiple beneficiaries
- Split payments
- Refund rules
- Timeout rules
- Dispute rules

Every release is controlled by workflow events.

### Workflow Engine

The Workflow Engine is the heart of the platform.

Workflows are configured, not coded.

Example workflow:

1. Request
2. Validation
3. Partner matching
4. Driver matching
5. Escrow
6. Pickup
7. Tracking
8. Delivery
9. Settlement
10. Review

Businesses only configure workflows.

### Event Engine

Events trigger actions.

Examples:

- Order created
- Driver assigned
- Partner accepted
- Pickup confirmed
- Refill completed
- Payment received
- Settlement released
- Delivery completed
- Customer rated

The Event Engine never knows which business created them.

### Verification Event Engine

Do not build a simple QR scanner. Build a reusable Verification Engine.

Each scan answers:

- Who scanned?
- What was scanned?
- Why?
- Where?
- When?
- Which workflow event should be triggered?

Example scan types:

- Driver pickup scan
- Station confirmation scan
- Delivery confirmation scan
- Inventory scan
- Future scan types

Each business defines what a scan means.

### Dispatch Engine

Supports:

- Capability matching
- Distance
- Availability
- Capacity
- Priority
- AI suggestions
- Manual override
- Partner policies
- Driver policies

### Tracking Engine

Stores tracking data only:

- Coordinates
- GPS
- ETA
- History
- Movement
- Geofencing
- Routes

No map rendering.

### Maps Adapter

Supports:

- Google Maps
- Mapbox
- HERE
- OpenStreetMap

Providers can be swapped. The backend exposes map data. The frontend renders it.

### Notification Engine

Supports:

- Push
- SMS
- Email
- WhatsApp, where available
- Voice
- In-app
- Future channels

### AI Engine

AI assists. AI never controls the platform.

Responsibilities:

- Dispatch
- Fraud detection
- Demand prediction
- Customer support
- Summaries
- Recommendations
- Reports

AI models must be replaceable.

---

## 7. Milestone 3: Business Module Framework

Businesses are plugins.

Each module defines:

- Capabilities
- Workflow
- Pricing policy
- Settlement policy
- Events
- Permissions
- Vehicle requirements
- Driver requirements
- Documents
- AI behaviors
- Reports
- Screens

No module modifies platform engines.

### First Business Module: LPG

The LPG module configures:

- Fixed pricing
- Nearest station matching
- Nearest qualified driver
- Cylinder verification events
- Station refill confirmation
- Escrow release to station
- Driver commission release upon completed delivery

Future business modules configure their own policies without changing the platform core.

---

## 8. Milestone 4: Reusable Frontend Foundation

Build a reusable design system first. Do not build isolated screens.

Reusable components:

- Buttons
- Cards
- Forms
- Inputs
- Dropdowns
- Search
- Filters
- Lists
- Tables
- Navigation
- Sidebar
- Bottom navigation
- Headers
- Maps
- QR components
- Wallet components
- Notification components
- Charts
- Dialogs
- Loading states
- Error states
- Themes

Every screen is assembled from reusable components.

---

## 9. Milestone 5: Platform Expansion

Once the foundation is complete, new modules become configuration work.

Examples:

- Restaurant
- Ride hailing
- Pharmacy
- Laundry
- Courier
- Marketplace
- Water delivery
- Construction
- Healthcare
- Future businesses

Each module plugs into:

- Workflow Engine
- Settlement Engine
- Pricing Engine
- Dispatch Engine
- Tracking Engine
- Notification Engine
- Financial Engine
- Wallet Engine
- Verification Engine

No core rewrite.

---

## 10. AI Development Workflow

Maintain separate AI conversations:

- Architect: Maintains the constitution and approves architecture.
- Backend Engineer: Builds reusable backend engines.
- Frontend Engineer: Builds reusable UI.
- QA & Security: Reviews quality, scalability, security, and performance.
- Documentation Manager: Updates documentation after every completed milestone.

---

## 11. Master Checklist for Every AI Agent

Before writing code, always verify:

- Is this reusable?
- Is this business-agnostic?
- Can another service use it?
- Is this configuration instead of hardcoding?
- Can this be an engine instead of a feature?
- Can this be an event instead of a conditional?
- Can this be a workflow instead of business logic?
- Can providers be swapped through adapters?
- Can currencies be enabled through configuration?
- Can payment policies change without code changes?
- Can company-adjustable financial policies be managed through authorized, versioned, auditable
  backend configuration?
- Do accepted financial obligations preserve their resolved policy and financial snapshots?
- Will this still work if 100 new business modules are added?

If the answer to any question is "No", redesign before implementing.

---

## Final Architectural Principle

Skima is a platform, not an application.

Applications are temporary. Platforms evolve.

Every engine, workflow, financial policy, settlement rule, currency, payment provider, map provider,
AI provider, and business module must be designed so it can be replaced, extended, or configured
without rewriting the platform foundation.
