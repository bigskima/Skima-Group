# SKIMA LPG — FINAL EXPO REACT NATIVE PRODUCT, UI/UX, MEDIA, MAPS, TRACKING, QR & WORKFLOW SPECIFICATION

## Authoritative implementation document

This document supersedes the previous LPG mobile frontend implementation instructions.

It is intended to be sufficiently complete for the developer/AI agent to **implement the production application directly**, not to create another planning document before development.

The developer must read this document as a single system specification. Requirements are grouped by domain deliberately. Do not partially implement a domain, jump elsewhere, and later return to finish the missing half without maintaining the contracts and architecture defined here.

---

# 0. AUTHORITATIVE DELIVERY PHASES

This phase ownership supersedes earlier LPG migration phase wording.

Current status:

```text
Phase 1 — Expo foundation                                      COMPLETE
Phase 2 — Customer, Driver and Station product completion      ACTIVE
Phase 3 — Full SKIMA company administration workflow           QUEUED
Phase 4 — Admin-to-product publishing and operational closure  LATER
```

## Phase 1 — Expo foundation

Phase 1 established the Expo React Native application, providers, authentication/session bootstrap,
routing, workspace access, reusable frontend foundations and valid backend connectivity.

## Phase 2 — Complete the Customer, Driver and Station product

Phase 2 owns every correction required inside the operational Expo application. It must be completed
before Phase 3 begins.

Phase 2 includes:

```text
premium native-mobile visual system and role-specific composition
production customer-facing language throughout the application
branded but configuration-driven asset placements and graceful fallbacks
educational onboarding and contextual permission education
customer home hierarchy and a backend-fed promotion surface
complete address resolution, location search, pin adjustment and deep map zoom
saved locations, live tracking, navigation context and stale-location handling
simple customer cylinder registration with a SKIMA-owned cylinder identity
opaque internal QR/NFC credentials and workflow-aware authorized scanning
profile/media flows, evidence, notifications and payment-return flows
loading, skeleton, empty, error, success, offline and reconnect states
draft persistence, resume, retry and server revalidation
responsive web and Android/iOS device behavior
real backend journey validation and remaining integration fixes
EAS configuration and required development, preview and installable builds
```

The mobile app must create reusable logical slots for company logos, wordmarks, onboarding artwork,
promotions, safety content and other company media. Phase 2 must not hardcode final company media or
pretend that mobile users can administer it.

## Phase 3 — Full SKIMA company administration workflow

Phase 3 is a separate company web application. It is not another workspace inside the Customer,
Driver and Station Expo app.

Phase 3 owns the authenticated admin workflows that create, review, publish, schedule, replace,
disable and retire configuration consumed by products. This includes:

```text
company profile and organization settings
brand asset library and logical placement management
logo, wordmark, onboarding, campaign, safety and empty-state media publishing
promotion/campaign creation, targeting, scheduling, priority and CTA management
content and notification management
service/module configuration and feature flags
service areas, stations, drivers, customers and approval operations
workflow, policy, pricing and settlement configuration through reusable engines
wallet, payout, support and operational oversight
admin roles, permissions, publishing history and operational audit views
```

The admin architecture must remain platform-wide and module-driven. LPG plugs into reusable admin
engines; core administration must never hardcode LPG-specific behavior.

## Phase 4 — Cross-surface publishing and operational closure

Phase 4 owns work that can only be accepted after both Phase 2 and Phase 3 exist:

```text
admin publish -> configuration/media API -> Expo consumption
brand and campaign preview across phone, tablet and web placements
audience, geography, service, priority and schedule enforcement
cache refresh, fallback, rollback and unpublished-content behavior
end-to-end admin/customer/driver/station operational acceptance
final correction of cross-surface integration defects
```

## Phase assignment rule

Use this rule for every new requirement:

```text
Customer, Driver or Station product behavior                     -> Phase 2
Admin creates/manages/publishes platform configuration           -> Phase 3
Acceptance depends on both the admin and an operational product  -> Phase 4
```

Do not add standalone review projects for security or performance to these phases. Do not add
app-store-readiness work or legacy Vite-removal work. This scope decision does not permit a feature
to ignore its required authorization, privacy, responsiveness or reliable backend behavior.

---

# 1. PRODUCT MISSION AND IMPLEMENTATION BOUNDARY

SKIMA LPG is a production LPG pickup, refill, return, tracking and fulfillment platform.

The production mobile application serves three operational workspaces:

**Customer**

**Independent Driver**

**Station**

The SKIMA company administration portal remains a separate web application.

The LPG mobile application is now being migrated fully to:

**Expo + React Native + TypeScript**

The target runtime is:

```text
                         SKIMA LPG
                             │
                    Expo React Native
                             │
             ┌───────────────┼───────────────┐
             │               │               │
          Android           iOS             Web
             │               │               │
        Google Play      App Store      Mobile browser
                                          Tablet
                                          Desktop
```

The migration is a **production frontend/platform migration**, not permission to casually rebuild the backend.

Existing valid backend systems must remain authoritative.

If a genuine backend correction, production improvement, missing capability, or security issue is discovered, document the exact issue and proposed change for approval.

Do not delete or replace valid backend systems merely because a different frontend architecture would make implementation easier.

The governing rule is:

> **Reuse the backend. Rebuild the presentation and device-integration layers. Improve backend capabilities only where genuinely necessary and explicitly approved.**

---

# 2. NON-NEGOTIABLE PLATFORM ARCHITECTURE

The current Vite mobile presentation is no longer the production mobile runtime.

Do not solve this migration using:

```text
Capacitor
a generic WebView wrapper
Expo DOM as the main application architecture
an embedded copy of the Vite website
browser HTML rendered inside the native application
```

The production LPG application must use genuine React Native components.

Current DOM constructs such as:

```tsx
<header>
<section>
<article>
<button>
<span>
<strong>
<img>
```

must become appropriate React Native primitives such as:

```tsx
<View>
<Text>
<Pressable>
<ScrollView>
<FlatList>
<SectionList>
<Image>
<TextInput>
```

The objective is not merely to produce an APK.

The objective is to produce a **real native-first application architecture**.

---

# 3. WHAT MUST BE PRESERVED FROM THE EXISTING APPLICATION

Do not interpret the migration as permission to throw away every frontend file.

Audit existing code and retain portable logic that does not depend on browser APIs.

Examples include existing:

```text
API clients
TanStack Query configuration
query keys
React Query hooks
TypeScript models
schemas
validation
money formatting
record utilities
permission utilities
workspace resolution
status helpers
date helpers
backend adapters
domain calculations that properly belong on the client
```

For example, hooks such as:

```tsx
useCylindersQuery()
useActiveOrdersQuery()
useQuotesQuery()
useLocationsQuery()
useWalletBalancesQuery()
useMessagesQuery()
useCurrenciesQuery()
```

should be evaluated individually.

If they communicate correctly with existing backend APIs and contain no browser-specific assumptions, reuse or migrate them rather than rewriting them without cause.

The migration model is:

```text
Existing backend
      │
      ├──────────── PRESERVE
      │
Portable frontend domain/API logic
      │
      ├──────────── AUDIT + REUSE
      │
Browser/Vite presentation
      │
      └──────────── REPLACE
                    │
                    ▼
             Expo React Native
```

---

# 4. BACKEND AUTHORITY AND CHANGE CONTROL

The following remain backend-controlled:

```text
authentication truth
profile records
organisations
roles
permissions
application approval
station eligibility
driver eligibility
service areas
pricing
quotes
order lifecycle
dispatch decisions
driver assignment
station assignment
workflow progression
wallets
ledger
payments
settlements
commissions
withdrawal rules
financial calculations that are authoritative
QR credentials
cylinder identity
verification results
scan authorization
audit records
notifications
provider integrations
business configuration
feature flags
public/private resource policies
```

The application may present and initiate authorized actions.

It must not independently become the source of truth for those actions.

If an existing API is inconvenient for React Native, create a frontend adapter.

Company-adjustable financial policy is additionally governed by the universal
[SKIMA Financial Policy Governance Directive](32-financial-policy-governance-directive.md).
The mobile application must submit only permitted operational inputs and render backend results;
it must not calculate, activate, or override authoritative financial amounts or policy versions.

Do not redesign the API merely for convenience.

If a required capability is genuinely absent, create a clearly identified backend-gap entry specifying:

```text
Required capability
Affected user/workspace
Affected screens
Why it is required
Current backend behavior
Expected backend behavior
Security implications
Proposed correction
Whether implementation is blocked without it
```

Backend corrections may then be approved separately.

---

# 5. TARGET REPOSITORY STRUCTURE

Use a maintainable domain-oriented architecture.

A recommended target is:

```text
apps/
  lpg-mobile/

    app/
      _layout.tsx

      (public)/
        index.tsx

      (auth)/
        login.tsx
        register.tsx
        verify-phone.tsx
        forgot-password.tsx

      (customer)/
        _layout.tsx
        ...

      (driver)/
        _layout.tsx
        ...

      (station)/
        _layout.tsx
        ...

    src/

      app/
        bootstrap/
        providers/
        session/
        guards/
        permissions/
        error-boundaries/
        lifecycle/

      workspaces/

        customer/
          screens/
          components/
          hooks/

        driver/
          screens/
          components/
          hooks/

        station/
          screens/
          components/
          hooks/

      features/

        auth/
        onboarding/
        applications/

        profiles/
        locations/

        cylinders/
        cylinder-registration/
        cylinder-media/
        cylinder-labels/
        cylinder-verification/

        stations/
        station-discovery/
        station-media/

        vehicles/
        vehicle-media/

        orders/
        quotes/
        fulfillment/

        dispatch/

        maps/
        location/
        routing/
        tracking/
        eta/

        scanning/
        scan-sessions/
        scan-evidence/
        verification/

        wallet/
        payments/
        settlements/
        commissions/
        receipts/

        notifications/
        communications/
        support/

        media/
        ai-media/
        company-assets/

        permissions/

      shared/

        api/
        adapters/
        components/
        design-system/
        hooks/
        responsive/
        platform/
        schemas/
        types/
        validation/
        utilities/
        constants/
        testing/
```

Do not create empty directories simply because they appear above.

Create a domain when real responsibility belongs there.

Do not move the old monolithic implementation into one differently named file.

---

# 6. APPLICATION BOOTSTRAP DOMAIN

The root application component must remain minimal.

Conceptually:

```tsx
export function App() {
  return (
    <AppProviders>
      <AppRouter />
    </AppProviders>
  );
}
```

The bootstrap layer is responsible for:

```text
theme initialization
secure session restoration
backend client initialization
query/cache initialization
network-awareness initialization
notification bootstrap
deep-link handling
workspace resolution
feature/capability resolution
error boundaries
safe-area initialization
```

It is not responsible for business screens.

---

# 7. DESIGN SYSTEM DOMAIN

A real SKIMA design system must be created before mass-producing screens.

The design system must control:

```text
brand colors
neutral colors
semantic colors
light theme
dark theme
typography
font sizes
font weights
line heights
spacing
radii
borders
shadows/elevation
icon sizes
touch targets
content widths
responsive breakpoints/layout modes
motion durations
skeleton behavior
focus treatment
disabled states
pressed states
```

Build reusable primitives for common interface behavior.

Examples:

```text
Screen
PageContainer
ContentContainer

AppHeader
SectionHeader
ScreenTitle

Button
IconButton
TextButton
FloatingAction

TextField
PhoneField
PasswordField
OTPField
SelectField
SearchField
DateField

Card
ActionCard
SummaryCard
MediaCard
StatusCard

Badge
StatusChip
StatusBanner

Avatar

BottomSheet
Dialog
Modal

EmptyState
ErrorState
OfflineState
PermissionState

SkeletonBlock
SkeletonCard

MoneyText

ResourceImage
CompanyAsset

CylinderCard
StationCard
OrderCard
JobCard
WalletCard
ReceiptCard
```

Do not create a giant `UniversalDashboard` component containing dozens of role-specific conditional branches.

Share primitives.

Keep workspace compositions intentional.

---

# 8. VISUAL QUALITY STANDARD

The previously produced dark prototype screens are **not** an acceptable visual baseline.

Do not port their visual system into React Native.

Problems that must be eliminated include:

```text
excessive empty space
very tall cards
poor information density
weak visual hierarchy
dark text on dark surfaces
oversized headings
arbitrary gradients
broken-media-looking placeholders
weak image placement
unbalanced composition
awkward floating buttons
inconsistent alignment
random spacing
prototype-quality presentation
```

The supplied Customer, Driver and Station journey references establish the quality bar.

They define:

```text
visual hierarchy
screen density
card proportions
form proportions
button prominence
navigation quality
map presentation
media placement
status presentation
progress indicators
typography
spacing rhythm
workflow visualization
```

They do **not** define backend workflow authority.

Never copy sample:

```text
people
addresses
prices
orders
balances
stations
drivers
vehicles
cylinder numbers
ETAs
ratings
statuses
```

as production data.

---

# 9. REFERENCE DESIGN VS BUSINESS LOGIC

The visual references show how SKIMA should feel.

The backend determines what SKIMA actually does.

For example, if a reference shows:

```text
Accept Job
Decline Job
```

but SKIMA LPG uses automatic driver assignment, do not introduce job acceptance simply to match the picture.

If a Station reference shows a workflow action that is inconsistent with the current authorized backend workflow, do not silently change either side.

Implement the current backend behavior and flag any genuine backend correction required.

The governing rule is:

> **Reference designs define presentation. Backend contracts define operational truth.**

---

# 10. RESPONSIVE LAYOUT DOMAIN

SKIMA must be mobile-first but **not mobile-only**.

The same product should support:

```text
small Android phones
large Android phones
iPhone
mobile browser
tablet
small laptop
desktop
large desktop
```

Responsive design does not mean stretching.

Never do this:

```text
430px mobile design
      ↓
width: 100%
      ↓
1440px giant phone screen
```

Instead:

```text
phone
→ mobile composition

tablet
→ tablet composition

desktop
→ desktop composition
```

Create centralized responsive modes such as:

```text
compact
medium
expanded
wide
```

and expose them through a common utility/hook.

Conceptually:

```tsx
const layout = useResponsiveLayout();
```

Do not scatter arbitrary screen-width checks throughout dozens of components.

---

# 11. CONTENT WIDTH DOMAIN

Use controlled maximum widths.

Indicative design ranges:

```text
Authentication/form panel
~420–520px

Simple detail/settings area
~600–760px

Customer workspace
~1100–1280px

Complex operational desktop workspace
~1200–1440px
```

These are not absolute hardcoded instructions.

They communicate the design principle.

A login input must not become 1,400px wide.

A Continue button must not stretch across a large desktop monitor.

A cylinder card should not become a billboard simply because more horizontal space exists.

---

# 12. PHONE COMPOSITION

Phone layouts should use:

```text
bottom navigation
stacked cards
horizontal collections where appropriate
full-screen workflow pages
bottom sheets
thumb-accessible actions
compact maps
native pickers
native camera flows
```

For Customer Home:

```text
Header
Greeting
Delivery Location
Primary Refill
Active Order
Quick Actions
My Cylinders
Stations Near You
Wallet / Recent Activity
Safety / Promotion
Bottom Navigation
```

Important information should be visible quickly.

---

# 13. TABLET COMPOSITION

Tablet layouts should recompose into grids or multiple columns where useful.

Example:

```text
Header

Refill                Active Order

Quick Actions

My Cylinders          Stations Near You

Wallet                Recent Activity
```

Do not simply enlarge phone cards.

---

# 14. DESKTOP WEB COMPOSITION

Desktop must feel like a deliberately designed application.

Customer example:

```text
┌───────────────┬────────────────────────────────────────────┐
│ SKIMA         │ Header / Location / Alerts / Account      │
│               ├────────────────────────────────────────────┤
│ Home          │                                            │
│ Cylinders     │ Greeting                                   │
│ Orders        │                                            │
│ Wallet        │ Refill              Active Order           │
│ Account       │                                            │
│               │ Quick Actions                              │
│               │                                            │
│               │ Cylinders                                  │
│               │                                            │
│               │ Stations Near You                          │
│               │                                            │
│               │ Wallet / Recent Activity                   │
└───────────────┴────────────────────────────────────────────┘
```

Desktop may use:

```text
sidebar navigation
larger maps
two-column forms
split panes
persistent detail panels
multi-column cards
hover interactions
keyboard navigation
pointer interactions
```

Do not stretch mobile bottom tabs across desktop.

---

# 15. THEME DOMAIN

Light and dark themes must be explicitly designed.

Dark mode is not:

```text
make background black
```

Define semantic tokens such as:

```text
background
surface
surfaceElevated
surfaceSubtle
border

textPrimary
textSecondary
textMuted
textInverse

brandPrimary
brandPressed
brandSubtle

success
successSurface

warning
warningSurface

danger
dangerSurface

information
informationSurface
```

Every major foreground/background pair must remain legible.

The previous dark prototype's black text over dark cards must not recur.

---

# 16. TYPOGRAPHY DOMAIN

Establish a restrained hierarchy:

```text
Display
Screen title
Section title
Card title
Body
Secondary body
Caption
Button
Status label
Financial amount
```

Avoid gigantic headings that consume half of a phone.

Avoid making every piece of text bold.

Avoid tiny body copy.

Maintain readable line lengths on desktop.

---

# 17. OPERATING-SYSTEM UI DOMAIN

SKIMA must never draw fake device interface elements.

Remove any custom:

```text
time
battery percentage
battery icon
charging indicator
Wi-Fi indicator
network/signal bars
camera notch
Android navigation buttons
gesture bar
iPhone home indicator
device frame
```

Use the real operating system.

SKIMA should:

```text
respect safe areas
configure native status-bar appearance
handle keyboard insets
handle system navigation insets
avoid content overlap
```

Device chrome belongs to Android/iOS.

---

# 18. NAVIGATION DOMAIN

## Customer primary navigation

```text
Home
Cylinders
Orders
Wallet
Account
```

## Driver primary navigation

```text
Home
Jobs
Scan
Earnings
Account
```

## Station primary navigation

```text
Dashboard
Jobs
Scan
Settlements
Account
```

Mobile should generally use bottom tabs.

Desktop may adapt the same semantic navigation into a sidebar.

Nested screens belong inside each domain.

Do not omit necessary screens simply because they do not fit in the primary navigation.

---

# 19. AUTHENTICATION DOMAIN

Authentication presentation should support existing backend capabilities including applicable:

```text
login
registration
phone/email verification
OTP
forgot password
session restoration
logout
account state
```

Do not build separate customer, driver and station authentication systems unnecessarily.

Use the existing identity model.

After authentication, resolve the user's authorized workspace(s).

Do not trust a locally selected role without backend authorization.

Sensitive authentication material must use secure native storage appropriate to the existing auth architecture.

Do not use browser `localStorage` in the native application.

---

# 20. ONBOARDING DOMAIN

Onboarding should be role-aware, educational and visually polished. It must feel like a native
product introduction rather than a web form or an internal dashboard.

The Welcome experience should include:

```text
SKIMA branding
focused hero visual
concise product value proposition
Get Started
Login
```

Branding and artwork must resolve through published logical asset placements. The UI may ship a
neutral layout-safe fallback, but it must not hardcode the final company logo or campaign artwork.

Customer onboarding should explain the service in short visual steps:

```text
Request a refill
SKIMA collects the cylinder
The cylinder is identified and tracked
An authorized partner refills it
SKIMA returns it to the customer
```

Use concise production copy, understandable progress, Back/Continue/Skip where appropriate and
contextual permission education before triggering an operating-system permission prompt.

Avoid the huge empty spaces visible in the previous prototype.

Customer onboarding should cover only information legitimately required by existing flows.

Driver onboarding should support:

```text
profile
vehicle
documents
application status
approval
```

Station onboarding should support:

```text
station identity
branch information
location
documents
public station media
application status
approval
```

Do not make approval decisions in the frontend.

---

# 21. WORKSPACE ACCESS & PERMISSIONS DOMAIN

Every protected screen/action must respect backend-provided permissions and workspace access.

Do not assume:

```text
customer = everything customer can theoretically do
driver = everything driver can theoretically do
station = everything station can theoretically do
```

Capabilities may vary by:

```text
approval status
staff role
station role
service area
feature flag
vehicle capability
backend configuration
account status
```

The UI should hide or disable unauthorized actions appropriately while keeping the backend as the final enforcement layer.

---

# 22. CUSTOMER HOME DOMAIN

Customer Home becomes the primary visual benchmark for the migration.

The screen should communicate within seconds:

```text
Who am I?
Where am I ordering to?
Which cylinders are mine?
Can I request a refill?
Do I have an active refill?
What is happening with it?
Which stations are around me?
What is my wallet/account situation?
```

Recommended hierarchy:

```text
Header
Greeting
Location selector

Published brand identity

Primary Refill Card

Active Order / Tracking Card

Published promotion/banner placement

Quick Actions

My Cylinders

Stations Near You

Wallet / Recent Activity

Safety / Promotional content
```

Cards must be compact.

Do not create huge empty hero cards.

Promotions must come from a backend-managed campaign contract and support an artwork placement,
title, short copy, CTA/action, audience, service/module, optional geographic targeting, active
window, enabled state and priority. The app must not require a release to change a campaign.

---

# 23. CUSTOMER CYLINDER DOMAIN

Customer cylinder screens should support:

```text
Cylinder list
Cylinder details
Register cylinder
Allowed edit operations
Cylinder original media
Presentation media
Verification state
Cylinder QR
Download printable label
Replace damaged label
Relevant history/status
```

Cylinder identifiers shown to users must come from the backend.

Never generate `CYL-...` client-side.

---

# 24. CYLINDER REGISTRATION DOMAIN

The production registration journey should conceptually support:

```text
Select backend-configured cylinder type
↓
Enter permitted physical details
↓
Enter manufacturer serial number where available
↓
Select/confirm actual cylinder colour
↓
Capture/upload required real cylinder photograph(s)
↓
Optionally prepare premium presentation image
↓
Review
↓
Submit through existing backend contract
↓
Backend creates cylinder
↓
Backend supplies cylinder status/reference
```

The frontend must not fake verification merely because registration succeeded.

Registration and verification are distinct concepts where the backend treats them as distinct.

---

# 25. CYLINDER COLOR DOMAIN

The customer should explicitly select or confirm the physical cylinder colour from backend-supported/configured options.

If `Other` is supported, follow current backend policy.

The confirmed colour must influence AI presentation generation.

If the customer's real cylinder is blue, the generated presentation should not become red merely because SKIMA branding is red.

---

# 26. MEDIA ARCHITECTURE DOMAIN

Media must be separated by purpose.

The frontend should conceptually distinguish:

```text
company_asset
original_upload
presentation_derivative
profile_media
public_business_media
document
verification_media
inspection_evidence
scan_evidence
pickup_evidence
refill_evidence
delivery_evidence
incident_evidence
```

Do not load one unrestricted global image list and guess ownership.

Media must remain connected to its actual backend resource.

Examples:

```text
Cylinder
→ cylinder media

Vehicle
→ vehicle media

Station
→ station media

Profile
→ profile media

Scan Event
→ evidence media
```

---

# 27. COMPANY ASSET DOMAIN

Company-owned presentation assets are different from user/resource media.

Examples:

```text
SKIMA logo variants
welcome imagery
promotional banners
safety banners
campaign artwork
support illustrations
generic empty-state artwork
```

These must be backend/admin-manageable through the Phase 3 administration workflow. Phase 2 owns
the reusable rendering placements, responsive composition, loading/fallback behavior and published
asset consumption contract. Phase 3 owns upload, replacement, publishing, scheduling and removal.

Conceptual slots may include:

```text
mobile.brand.logo.primary
mobile.brand.logo.compact
mobile.welcome.hero
mobile.onboarding.customer
mobile.onboarding.driver
mobile.onboarding.station
mobile.home.promotion
mobile.safety.banner
mobile.empty.cylinders
mobile.empty.orders
```

The mobile application should consume published assets by logical placement rather than hardcoding remote marketing images into components.

A logical placement response should be capable of carrying the published media reference, suitable
variants, accessibility text, destination/action metadata, active dates and revision information.
Missing or unpublished assets must collapse gracefully without leaving a broken image or an empty
marketing-sized hole in the interface.

Native technical exceptions such as installed app icon and basic native splash assets may be bundled because the operating systems require them.

---

# 28. AI PRESENTATION MEDIA DOMAIN

SKIMA should support AI-assisted presentation imagery for approved, publicly displayable physical assets.

The purpose is:

> **Users provide the real asset. SKIMA provides a polished representation suitable for a premium interface.**

AI presentation media may apply to approved categories such as:

```text
customer cylinder
driver vehicle
station exterior/branch
storefront
other explicitly approved public physical asset
```

It must not be treated as evidence.

---

# 29. ORIGINAL IMAGE VS AI PRESENTATION IMAGE

Always preserve both.

Conceptually:

```text
Physical Cylinder
      │
      ├── Original Upload
      │      Actual user photograph
      │
      └── Presentation Derivative
             AI-assisted polished representation
```

The original is the authentic source.

The presentation derivative is intended for:

```text
Customer Home
Cylinder cards
public-facing galleries
order summaries
approved asset profiles
station discovery
vehicle presentation
```

Do not overwrite the original.

---

# 30. AI CYLINDER PRESENTATION DOMAIN

A typical experience:

```text
Customer photographs actual cylinder
↓
Original securely uploaded
↓
Customer confirms cylinder details
↓
Customer confirms colour
↓
Presentation generation requested
↓
AI creates clean professional representation
↓
Customer previews result
↓
Presentation derivative becomes available
```

Allowed presentation improvements may include:

```text
clean background
better lighting
improved exposure
better framing
reasonable perspective normalization
consistent cropping
professional composition
presentation-quality visual clarity
```

The generated representation should remain grounded in the real uploaded asset.

---

# 31. AI SAFETY BOUNDARIES

AI presentation processing must never intentionally:

```text
hide safety-relevant rust
erase damage
repair a damaged valve
invent manufacturer branding
invent serial numbers
invent capacity markings
invent regulatory markings
fabricate certification
imply inspection approval
change physical evidence
create a completely fictional station and present it as real
```

The AI derivative is **not** an inspection source.

---

# 32. SENSITIVE MEDIA EXCLUSION DOMAIN

Never apply AI-generated/enhanced presentation processing to:

```text
government IDs
driver licences
passports
vehicle registration documents
insurance certificates
CAC documents
business permits
fire/safety certificates
proof of address
bank documents
KYC uploads
serial-number evidence
inspection evidence
damage evidence
pickup evidence
station-receipt evidence
refill evidence
delivery evidence
incident evidence
QR scan evidence
```

Authenticity-sensitive media must remain authentic.

Normal technical resizing/compression that does not materially alter evidence is separate from AI visual transformation.

---

# 33. AI PROVIDER ARCHITECTURE

Gemini may be the preferred first provider.

Gemini must **not** become the architecture.

Do not scatter Gemini calls through screen components.

Use a provider-independent conceptual interface such as:

```ts
interface PresentationMediaService {
  createPresentationAsset(
    input: PresentationMediaRequest
  ): Promise<PresentationMediaResult>;
}
```

The UI should understand:

```text
asset type
source media
confirmed attributes
processing state
result
failure
retry eligibility
```

not provider-specific implementation details.

This allows SKIMA to change providers later.

---

# 34. AI SECURITY

Never place private AI credentials in the client.

Do not put Gemini/provider secrets in:

```text
EXPO_PUBLIC_*
app.json
app.config.ts
JavaScript bundles
SecureStore
AsyncStorage
native resources
client environment variables
```

Provider calls requiring private credentials must occur through an authorized server-side SKIMA integration.

If that integration is missing, document the required backend addition for approval.

Do not compromise API credentials to avoid a backend task.

---

# 35. AI PROCESSING UX

Support clear states:

```text
Original uploaded
Preparing
Generating presentation
Generation completed
Preview
Use presentation
Regenerate where allowed
Keep original
Generation failed
Generation temporarily unavailable
```

A cosmetic AI failure should not automatically destroy a legitimate underlying registration unless backend policy explicitly makes generation mandatory.

---

# 36. STATION DISCOVERY DOMAIN

Customer Home must include **Stations Near You**.

Also provide a complete station discovery experience.

Customers should be able to discover registered stations based on legitimate backend/location information.

Do not fake proximity.

Do not fabricate stations.

Do not fabricate prices.

Do not fabricate operating status.

---

# 37. STATION CARD DOMAIN

Where the backend provides authorized public data, station cards may show:

```text
station/branch public name
public logo
approved public photograph
presentation derivative
distance
public price/kg
opening status/hours
service availability
public verification indicator
services offered
```

Use a compact, premium card.

Mobile example:

```text
Stations Near You                         View all →

┌─────────────────────┐
│ Station photograph  │
│                     │
│ Prime Gas           │
│ 1.8 km              │
│ ₦X/kg               │
│ Open                │
└─────────────────────┘
```

Do not show a field if it is unavailable rather than inventing a believable value.

---

# 38. PUBLIC STATION PRIVACY DOMAIN

Never expose:

```text
owner private phone
private email
KYC
bank details
settlement account
wallet balance
internal commission
private staff records
regulatory source documents
private inventory
internal risk/fraud information
audit logs
internal database UUID
security configuration
private operational notes
```

The frontend should prefer explicit public station representations returned by the backend.

Do not fetch a highly privileged station object and rely only on visual hiding.

---

# 39. STATION DETAILS DOMAIN

Station Details may include, where supported:

```text
public station identity
station photos
presentation media
branch address/location
map position
distance
public operating hours
public LPG price
public services
availability
verification state intended for customers
directions
order/refill action where product rules allow
```

On desktop, Station Details can use a map/detail split layout.

On mobile, use a compact stacked layout.

---

# 40. LOCATION DOMAIN

The application needs a complete location layer.

Use Expo/native location APIs where appropriate.

Customer location capabilities should support:

```text
request current-location permission
current device location
saved customer locations
manual address selection
location search where supported
map selection where appropriate
delivery-address selection
location permission recovery
location accuracy awareness
```

Coordinates must be reverse-geocoded through the configured maps adapter into the best available
human-readable hierarchy:

```text
country -> state/region -> city/town -> locality/area -> street/road -> address/landmark
```

The location UI must prioritize that address over raw latitude/longitude, provide search and
autocomplete where the configured provider supports them, allow manual map selection, and let the
user adjust a detected pin before saving. When an exact street is unavailable, fall back cleanly to
locality, city and state rather than showing an empty or fabricated address.

Never block the entire product permanently simply because precise location permission is denied when manual address selection can satisfy the workflow.

The backend remains authoritative for:

```text
service-area eligibility
station eligibility
dispatch eligibility
pricing distance
coverage decisions
```

---

# 41. MAP DOMAIN

Maps are a first-class production capability, not decorative images.

Map components should be reusable and domain-aware.

Supported contexts may include:

```text
customer station discovery
customer order tracking
driver route to customer
driver route to station
driver return route
station driver-arrival view
address selection
delivery confirmation context
service availability visualization where supported
```

Maps must support:

```text
loading state
permission state
location unavailable
route unavailable
network failure
map provider failure
user location where authorized
destination marker
driver marker where authorized
station marker
customer delivery marker
route polyline where supported
camera fitting/viewport management
deep user-controlled zoom appropriate for building/compound selection
recenter/current-location control
manual pin placement and pin adjustment in selection contexts
```

Do not use static mock map images in production.

Do not lock the camera at a city-level zoom after a precise device or selected coordinate exists.
Tracking views should fit the relevant route and markers; location-selection views should permit
close inspection of the selected building, compound, road or pickup point where provider data
supports it.

---

# 42. LIVE TRACKING DOMAIN

Live tracking must be treated as its own product subsystem.

The UI should support relevant phases such as:

```text
Driver assigned
Driver heading to customer
Driver approaching pickup
Cylinder picked up
Driver heading to station
Driver at station
Refill in progress
Refill completed
Driver returning to customer
Driver approaching customer
Delivered
```

Actual state names must correspond to current backend workflow contracts.

Do not invent frontend-only workflow states.

---

# 43. CUSTOMER LIVE TRACKING

When an active order has authorized tracking data, the customer should be able to see:

```text
current order status
map
driver position where policy allows
customer destination
station where appropriate
route/progress
ETA
distance
driver public identity
vehicle public identity where appropriate
contact/support action where policy permits
timeline/progress steps
```

Tracking must remain useful even when precise live coordinates are temporarily unavailable.

For example:

```text
Driver is heading to you
Last updated 2 minutes ago
```

is preferable to pretending that an old coordinate is live.

---

# 44. DRIVER NAVIGATION DOMAIN

The driver workspace should have clear route screens for each authorized leg.

Examples:

```text
Navigate to Customer
Navigate to Station
Return to Customer
```

Driver route screens should emphasize:

```text
destination
distance
ETA
map
route
current job
customer/station public operational details
Start/Open Navigation
arrival action
support/contact where allowed
```

If turn-by-turn navigation is delegated to Google Maps/Apple Maps or another provider, launch it cleanly using supported deep linking.

Do not attempt to recreate a full turn-by-turn navigation engine unless explicitly required.

---

# 45. STATION TRACKING DOMAIN

Station staff should be able to see relevant incoming-driver information where authorized:

```text
driver assigned
driver en route
estimated arrival
driver arrived
current order/job
driver public identity
vehicle presentation
```

Private driver information must remain hidden.

---

# 46. LOCATION UPDATE AND FRESHNESS DOMAIN

Tracking screens must distinguish:

```text
live/current
recent
stale
unavailable
```

Do not silently display a 15-minute-old coordinate as though it is current.

Where the backend provides update timestamps, display or use them appropriately.

If freshness information is absent but required for production tracking, document the backend improvement for approval.

---

# 47. ETA DOMAIN

ETA displayed in the app must come from an authorized routing/backend source.

Do not calculate simplistic client-side ETA such as:

```text
distance / arbitrary fixed speed
```

and present it as production truth.

The frontend may format or display ETA.

The routing/backend layer should determine authoritative values.

If ETA is unavailable:

```text
Calculating ETA
ETA unavailable
```

is better than fake data.

---

# 48. TRACKING PERFORMANCE DOMAIN

Live map updates must not cause the entire screen to rerender unnecessarily.

Separate:

```text
map position updates
order data
driver identity
timeline state
financial summary
```

into appropriately scoped state/query layers.

Throttle/debounce presentation updates when necessary.

Do not aggressively poll at a rate that wastes customer data or battery.

Use the existing backend transport strategy.

If production tracking requires realtime/websocket/subscription capabilities not currently adequate, document the backend improvement rather than inventing duplicate client-side infrastructure.

---

# 49. BACKGROUND LOCATION DOMAIN

Driver background location is sensitive and platform-regulated.

Use it only where the actual dispatch/tracking workflow requires it.

Requirements include:

```text
clear permission explanation
platform permission compliance
start only for legitimate active operational state
stop when no longer required
battery-awareness
privacy-awareness
backend-authorized upload behavior
graceful denial handling
```

Do not run continuous location tracking simply because the driver app is installed.

If the current backend does not support the required tracking ingestion, document that gap for approval.

---

# 50. ORDER DOMAIN

Customer order presentation should support the real backend journey from quote through completion.

Conceptually:

```text
Select cylinder
↓
Select requested refill amount/allowed option
↓
Delivery address
↓
Quote/price breakdown
↓
Payment
↓
Order placed
↓
Driver/station assignment
↓
Pickup
↓
Station/refill
↓
Return
↓
Delivery confirmation
↓
Receipt
↓
History
```

Actual intermediate statuses must follow backend truth.

Do not manufacture a frontend state machine that can diverge from the backend.

---

# 51. QUOTE AND PRICE PRESENTATION DOMAIN

All prices must come from real backend data.

Price breakdown can show applicable components such as:

```text
LPG amount
delivery fee
distance component
platform fee
discount
other configured charge
total
```

only where the backend provides/supports them.

Do not hardcode:

```text
price per kg
markup
delivery fee
platform margin
driver share
station share
```

in React Native.

---

# 52. ACTIVE ORDER DOMAIN

The active-order card should be compact but highly informative.

It may show:

```text
order reference
status
current fulfillment stage
driver/station where permitted
ETA
primary tracking action
```

The active order should be visually more important than low-priority information.

---

# 53. DRIVER JOB DOMAIN

Driver Home should prioritize operational work.

Show relevant:

```text
current assignment
next action
route state
today's earnings
completed trips/jobs
important alerts
availability state where supported
```

If LPG jobs are auto-assigned, the UI must reflect assignment, not marketplace-style acceptance.

Do not introduce Accept/Decline unless the backend explicitly supports it for that workflow.

---

# 54. DRIVER VEHICLE DOMAIN

Vehicle screens should support existing data and application workflows including:

```text
vehicle type
make
model
colour
plate/reference where allowed
public presentation media
actual source media
documents
verification/approval state
capabilities where exposed
```

AI presentation media may create a clean vehicle representation from a real vehicle upload.

Never use that derivative as regulatory proof.

---

# 55. STATION JOB DOMAIN

Station users should be able to see operational jobs/orders relevant to that station.

Depending on backend role/permissions:

```text
pending/incoming work
driver approaching
driver arrived
cylinder handling
refill progression
completion
settlement outcome
history
```

Do not add station acceptance if the backend automatically assigns the station.

---

# 56. STATION ROLES DOMAIN

The Station workspace may support different staff capabilities such as:

```text
Owner/Admin
Authorized Scanner/Operations Staff
Pump/Refill Attendant
other backend-defined roles
```

Do not hardcode these names if existing backend permissions use a different model.

Render functionality according to actual permission/capability data.

---

# 57. CYLINDER QR IDENTITY DOMAIN

Customers must never create their own SKIMA cylinder reference or QR credential.

The backend remains responsible for:

```text
internal cylinder ID
public cylinder reference
QR credential
credential version
credential lifecycle
verification status
audit records
```

The frontend displays them.

Manufacturer/model/serial information is supplementary metadata unless a configured safety or
regulatory policy requires it. Customer registration must not depend on an obscure external
identifier. Orders may change while the SKIMA cylinder identity remains stable.

---

# 58. PRINTABLE QR LABEL DOMAIN

Registered cylinders should support a production identity label where backend capability exists.

Customer actions:

```text
View Cylinder QR
Download Label
Print Label
Replace Damaged Label
```

Visible label content should contain appropriate public information such as:

```text
SKIMA LPG

Cylinder: CYL-20481

Scan with SKIMA to verify this cylinder.
```

Do not expose:

```text
customer phone
customer email
customer address
internal UUID
payment information
```

The QR credential should remain opaque/backend-issued rather than a raw database ID.

---

# 59. LABEL FILE DOMAIN

Where supported, customers should be able to obtain:

```text
in-app QR view
PNG
PDF
print-friendly label
```

Do not generate the authoritative production label by taking a screenshot of a React Native view.

Use the existing backend/document service where available.

If printable generation is missing, document the backend capability required for approval.

---

# 60. QR CREDENTIAL LIFECYCLE DOMAIN

Credential states may include backend-defined equivalents of:

```text
Issued
Active
Revoked
Replaced
Compromised
Expired where applicable
```

The frontend must not decide credential validity.

A replacement flow should use backend behavior to revoke/replace credentials where required.

---

# 61. SCANNING DOMAIN

Scanning must use native camera capabilities.

The scanner UX should include:

```text
camera permission handling
permission-denied recovery
scanner frame/guidance
QR detection
torch
focus guidance
duplicate detection
timeout
retry
manual reference entry where policy permits
network recovery
accessible instructions
```

Do not use browser-style camera flows for native.

Never send an unrecognized scan to Google Search or another external browser. A SKIMA scan is an
internal verification action: submit the opaque credential and current workflow context to the
backend, then render only the authorized result and valid next action returned by the verification
engine.

---

# 62. SCAN SESSION DOMAIN

Where the backend uses scan sessions, the app should request the current authorized session before a security-sensitive scan.

A session may conceptually expose:

```json
{
  "scanSessionId": "...",
  "scanType": "driver_pickup",
  "orderReference": "...",
  "expectedResourceType": "lpg_cylinder",
  "expiresAt": "...",
  "instructions": "...",
  "photoEvidenceRequired": true,
  "manualEntryAllowed": true
}
```

Do not hardcode these rules.

Use backend response/contracts.

---

# 63. SCAN VERIFICATION DOMAIN

After camera detection:

```text
Camera reads QR
↓
App obtains token
↓
App submits token + authorized workflow context
↓
Backend verifies
↓
Backend responds
↓
Only then show verified state
```

Never do:

```text
QR detected
↓
"Valid Cylinder"
```

without backend verification.

---

# 64. DRIVER PICKUP SCAN DOMAIN

Driver pickup may require:

```text
authorized current job
correct cylinder
valid QR credential
pickup location/context
evidence photograph
backend confirmation
workflow advancement
```

The UI should clearly communicate each state.

---

# 65. STATION SCAN DOMAIN

The latest production UI/QR requirements include station-authorized scan contexts.

Therefore the frontend architecture must support station scan workflows **when authorized by the backend**.

If the existing backend currently implements only driver-held scanning and does not authorize station scanning, do not silently rewrite that backend during frontend migration.

Instead flag the discrepancy as a backend correction decision for approval.

This must be resolved deliberately before declaring station scan functionality complete.

---

# 66. DELIVERY SCAN/VERIFICATION DOMAIN

Return/delivery verification should follow the current backend workflow.

Potential mechanisms may include:

```text
QR scan
customer confirmation
OTP
backend rule-driven auto-confirmation
other authorized verification
```

The frontend must not choose the mechanism independently.

---

# 67. EVIDENCE DOMAIN

Evidence media is different from presentation media.

Evidence may include:

```text
pickup evidence
station receipt evidence
inspection evidence
refill evidence
delivery evidence
incident evidence
```

Evidence must:

```text
capture the real state
use authentic photo/video where required
upload securely
be associated with the correct resource/event
remain unmodified by AI presentation processing
```

---

# 68. EVIDENCE INTEGRITY DOMAIN

For sensitive actions, the frontend should transmit existing required metadata such as:

```text
scan session
order
cylinder
actor
scan type
device-reported location where permitted
location accuracy
captured media
idempotency information
```

The backend remains responsible for authoritative timestamping and audit.

Do not treat EXIF timestamps as authoritative.

---

# 69. WALLET DOMAIN

Customer, Driver and Station wallet experiences should use the existing financial architecture.

The UI can display:

```text
available balance
pending balance where supported
transactions
earnings
top-up
withdrawal
payment history
settlement history
```

depending on workspace and backend capability.

The ledger remains the financial source of truth.

Never reconstruct a wallet balance by locally summing arbitrary UI transactions if the existing backend exposes the authoritative balance.

---

# 70. PAYMENT DOMAIN

Payment screens should consume backend-provided methods and configuration.

Possible rails may include whatever is currently enabled, such as:

```text
wallet
card
bank
USDC
other configured providers
```

Do not expose a payment method simply because it appears in an old mockup.

Do not hardcode payment providers.

---

# 71. DRIVER EARNINGS DOMAIN

Driver Earnings should show authorized information such as:

```text
current balance
pending earnings
completed job earnings
commission breakdown where exposed
earnings history
withdrawal
transaction details
```

Financial state remains backend-controlled.

---

# 72. STATION SETTLEMENT DOMAIN

Station Settlements should support backend-provided:

```text
station earnings
pending settlement
released settlement
transaction history
withdrawal
settlement details
```

Do not independently calculate releases based on frontend workflow state.

---

# 73. RECEIPTS AND INVOICES DOMAIN

The app should provide user-facing access to backend-generated/authorized receipts and invoices where available.

Receipt presentation may include:

```text
order reference
date/time
cylinder/refill
amount
fees
total
payment status
station
transaction reference
```

Do not fabricate invoice numbers.

Do not use a screenshot of a screen as the authoritative receipt file if a proper backend document capability exists.

---

# 74. NOTIFICATIONS DOMAIN

Notifications should support:

```text
notification list
read/unread state
relevant navigation destination
order changes
driver/station workflow updates
payment changes
security messages
application status
support communication
```

All content must come from actual notification records.

Do not fake notifications to fill empty space.

---

# 75. PUSH NOTIFICATION DOMAIN

Use Expo/native push infrastructure appropriate to the existing backend integration.

The frontend needs to handle:

```text
permission request
token registration
token refresh/change
foreground notification
background/open behavior
notification deep linking
disabled permission guidance
```

If the backend lacks required push-token support, document it for approval.

Do not embed provider secrets in the app.

---

# 76. COMMUNICATION AND SUPPORT DOMAIN

Support access should be integrated intentionally.

Depending on existing capabilities this may include:

```text
support center
help articles
contact support
incident reporting
order-specific help
phone/chat links where permitted
```

Do not expose private staff telephone numbers simply to provide support functionality.

---

# 77. DEEP LINK DOMAIN

Navigation should support meaningful deep links for:

```text
order details
tracking
cylinder details
station details
notifications
application status
payment result
```

where appropriate.

Expo/native deep links and web URLs should resolve into equivalent product destinations.

Unauthorized users must still pass authentication/permission guards.

---

# 78. OFFLINE AND NETWORK RESILIENCE DOMAIN

SKIMA is expected to work in environments with unstable network connectivity.

Every relevant feature should distinguish:

```text
online
offline
reconnecting
cached
pending upload
pending retry
server-confirmed
```

The application may preserve:

```text
form drafts
pending media upload information
query cache
authorized queued action metadata
```

but must not become another source of truth.

---

# 79. SECURITY-SENSITIVE OFFLINE RULES

The application may show:

```text
Waiting for connection
Upload pending
Verification pending
```

It must not show:

```text
Verified
Completed
Payment released
Settlement released
```

until the backend confirms the outcome.

Queued operations should remain idempotent according to existing backend capabilities.

If reliable idempotency is missing for a required production operation, document that backend improvement for approval.

---

# 80. MEDIA UPLOAD RESILIENCE DOMAIN

Large media uploads should support:

```text
progress
retry
cancellation where appropriate
network loss
resume strategy where supported
upload success
upload failure
server confirmation
```

Do not keep critical evidence only on the device after the workflow has been considered complete.

---

# 81. LOADING DOMAIN

Do not use a blank page containing only a spinner as the default screen-loading experience.

Every major screen requires a layout-specific skeleton.

Examples:

```text
CustomerHomeSkeleton
CustomerCylindersSkeleton
CustomerCylinderDetailsSkeleton
CustomerOrdersSkeleton
CustomerOrderDetailsSkeleton
CustomerWalletSkeleton
StationDiscoverySkeleton
StationDetailsSkeleton

DriverHomeSkeleton
DriverJobsSkeleton
DriverJobDetailsSkeleton
DriverTrackingSkeleton
DriverScanSkeleton
DriverEarningsSkeleton

StationDashboardSkeleton
StationJobsSkeleton
StationJobDetailsSkeleton
StationScanSkeleton
StationSettlementsSkeleton
```

Skeletons should:

```text
resemble destination geometry
avoid fake records
preserve layout dimensions
reduce content jumping
support light/dark themes
use subtle animation
```

---

# 82. EMPTY STATE DOMAIN

Every data surface must have a designed empty state.

Examples:

```text
No cylinders yet

Register your first cylinder to request LPG refills.

[Register Cylinder]
```

or:

```text
No active refill

Your next active LPG order will appear here.
```

Never substitute believable fake records.

---

# 83. ERROR STATE DOMAIN

Support:

```text
screen-level errors
section-level errors
network errors
authorization errors
media errors
map errors
location errors
payment errors
scan errors
```

One failed section should not necessarily destroy an otherwise usable screen.

Offer appropriate retry where safe.

---

# 84. IMAGE RENDERING DOMAIN

Never distort images.

Use correct presentation behavior:

```text
contain
cover
preserved aspect ratio
appropriate crop
thumbnail
full-resolution viewer
```

Cylinder product-style images will often use `contain`.

Station photography may use controlled `cover`.

Do not stretch a 480px image to fit a 1,400px arbitrary rectangle.

---

# 85. NATIVE CAPABILITY DOMAIN

Audit/install only dependencies genuinely required by the implementation.

Likely categories include appropriate Expo/native equivalents of:

```text
camera
image
image picker
location
notifications
secure storage
filesystem
sharing
linking
haptics
safe areas
network state
maps
QR/barcode scanning
```

For example, depending on selected Expo SDK and compatibility:

```text
expo-camera
expo-image
expo-image-picker
expo-location
expo-notifications
expo-secure-store
expo-file-system
expo-sharing
expo-linking
expo-haptics
react-native-safe-area-context
lucide-react-native
```

Exact package selection must use the versions compatible with the chosen Expo SDK.

Do not install libraries blindly.

For every third-party dependency, evaluate:

```text
purpose
maintenance
Expo compatibility
Android support
iOS support
web support
native-build requirements
security
bundle/performance impact
```

---

# 86. PERFORMANCE DOMAIN

Build for real devices, including lower-resource Android devices.

Use appropriate:

```text
FlatList
SectionList
virtualization
image thumbnails
image caching
query caching
lazy loading
code splitting/web optimization where supported
memoization only where useful
scoped state updates
```

Avoid:

```text
enormous ScrollViews with hundreds of children
full-resolution images where thumbnails suffice
rerendering entire tracking screens for each coordinate
unnecessary polling
large synchronous operations on the UI thread
```

Performance should be measured rather than assumed.

---

# 87. ACCESSIBILITY DOMAIN

Production quality includes accessibility.

Implement:

```text
screen-reader labels
semantic roles
adequate touch targets
reasonable text scaling
sufficient contrast
logical focus order
keyboard navigation on web
visible web focus indicators
accessible forms
accessible scanner instructions
accessible error messaging
reduced-motion awareness where supported
```

Do not sacrifice accessibility simply to imitate a screenshot.

---

# 88. MOTION DOMAIN

Use subtle motion where it improves understanding:

```text
navigation transitions
bottom-sheet movement
button feedback
scan success
order success
skeleton shimmer
progress changes
accordion expansion
```

Do not fill the application with decorative animation.

SKIMA should feel fast, calm and operational.

---

# 89. SECURITY AND PRIVACY DOMAIN

Never expose secrets in the client.

Protect:

```text
auth tokens
private API credentials
AI credentials
payment provider secrets
backend service credentials
private customer data
private driver data
private station data
KYC/regulatory media
financial information
internal IDs where unnecessary
```

Use secure storage for sensitive client-side session material according to the existing auth architecture.

Web and native permission boundaries must be respected.

Do not log sensitive documents, tokens or payment information to production console/debug services.

---

# 90. PUBLIC VS PRIVATE DATA CLASSIFICATION DOMAIN

The frontend should explicitly think in these categories:

```text
PUBLIC PRESENTATION DATA
PUBLIC BUSINESS MEDIA

PRIVATE PROFILE DATA
OPERATIONAL DATA
FINANCIAL DATA
KYC/REGULATORY DATA
EVIDENCE DATA
INTERNAL ADMIN DATA
```

Station discovery and AI public presentation media can consume only intentionally public categories.

Something is not public merely because an API returned it.

---

# 91. CUSTOMER RESPONSIVE EXPERIENCE DOMAIN

Customer web should adapt intelligently.

Mobile:

```text
bottom tabs
stacked cards
horizontal station/cylinder collections
compact maps
full-screen workflows
```

Tablet:

```text
two-column dashboard sections
larger map
grid cards
```

Desktop:

```text
sidebar navigation
contained dashboard
multi-column cards
station map/list split
wider order-tracking map
appropriate details panel
```

Do not maintain a separate customer product merely to achieve responsiveness unless there is a compelling architectural reason.

---

# 92. DRIVER RESPONSIVE EXPERIENCE DOMAIN

Driver is primarily mobile because drivers operate in the field.

Native mobile gets priority.

Driver web may provide useful account/history/management experiences where supported, but never compromise the field-oriented native UI merely to create desktop symmetry.

Mobile should prioritize:

```text
current job
route
scan
navigation
earnings
```

Desktop can show wider historical and account views where appropriate.

---

# 93. STATION RESPONSIVE EXPERIENCE DOMAIN

Station staff may use phones, tablets and desktop browsers.

Therefore Station needs particularly strong adaptive design.

Mobile:

```text
current jobs
scan
refill state
settlements
```

Tablet/desktop:

```text
operational dashboard
job list/detail split
incoming-driver tracking
settlement overview
staff-access views where authorized
```

The Station workspace is still not the SKIMA company admin portal.

---

# 94. WEB ROUTING DOMAIN

Web routes should be meaningful and deep-linkable where practical.

Examples conceptually:

```text
/orders/:id
/cylinders/:id
/stations/:id
/jobs/:id
```

Actual Expo Router structure should preserve security/workspace guards.

Do not expose internal database IDs unnecessarily in public-facing URLs if the existing architecture provides public references.

---

# 95. WEB INTERACTION DOMAIN

Desktop/browser interfaces should support:

```text
mouse
hover
keyboard
focus
larger displays
browser navigation
copy/select where appropriate
responsive dialogs
```

Do not force mobile-only gestures on desktop users.

---

# 96. ADMIN INTEGRATION BOUNDARY

The SKIMA company admin portal remains separate and is delivered as Phase 3.

The mobile migration should not merge the admin portal into the Expo customer/driver/station application.

However, mobile may consume company-managed assets/configuration produced by the admin system.

The separate-admin boundary does not defer financial-policy governance. The company admin system
must provide the authorized policy authoring, approval, scheduling, activation, history, and
rollback workflow required by the
[SKIMA Financial Policy Governance Directive](32-financial-policy-governance-directive.md). It must
call backend policy/configuration APIs and must never become a client-side financial source of
truth. Existing finance action screens are not substitutes for this controlled policy-management
surface.

Company administration must manage through reusable, permission-driven workflows:

```text
company media
promotions
safety content
feature flags
pricing/rules
service areas
stations
drivers
approvals
payout controls
```

according to existing backend/admin architecture.

---

# 97. NO PRODUCTION HARDCODING DOMAIN

Do not hardcode:

```text
customer names
driver names
station names
addresses
prices
balances
currency
order IDs
cylinder references
cylinder media
vehicle media
station media
ETAs
ratings
statuses
coordinates
route paths
workflow states
scan results
inspection outcomes
wallet totals
commissions
settlements
inventory
availability
verification outcomes
```

Use:

```text
loading
empty
unavailable
permission
offline
error
```

when production data does not exist.

---

# 97A. CUSTOMER-FACING CONTENT DOMAIN

Audit every visible string in Customer, Driver and Station experiences. Product users must receive
concise, natural and reassuring language written for the action they are performing.

Never expose raw status enums, provider names, API/database terminology, workflow-engine terms,
configuration keys, internal permission names, stack traces or raw backend errors. Map internal
states and errors through reusable, configuration-aware presentation copy while retaining technical
details only in authorized logs and admin/operational surfaces.

Copy should explain what happened, whether the user's action was saved or confirmed, and what they
can do next. Empty, offline, permission-denied, retry and verification-pending messages are product
states, not developer diagnostics.

---

# 98. TESTING DOMAIN — UNIT AND COMPONENT

Test domain logic and reusable components.

Include:

```text
formatting
validation
responsive utilities
permission rendering
status rendering
query adapters
media-purpose selection
AI-media state machine
map/tracking state presentation
financial display
offline state transitions
```

Components should be testable without a full device where feasible.

---

# 99. TESTING DOMAIN — INTEGRATION

Integration tests should verify:

```text
auth → workspace
customer → cylinders
customer → stations
customer → quote/order
driver → assignment
driver → map/tracking
driver → scan
station → job
station → authorized scan where supported
wallet → transactions
notifications → destination
media upload → resource association
```

Use real contracts or faithful test environments.

Do not write tests around fake architecture that bypasses the backend contract layer.

---

# 100. TESTING DOMAIN — RESPONSIVE VISUAL QA

Representative widths must be tested around:

```text
360px
390px
430px
768px
1024px
1280px
1440px+
```

Test:

```text
no stretching
no horizontal overflow
no giant inputs
no giant buttons
no distorted images
no clipped cards
no content under system UI
correct bottom tabs
correct desktop navigation
correct maps
proper typography
proper spacing
proper dark/light contrast
```

---

# 101. TESTING DOMAIN — DEVICE QA

Test actual Android builds.

Also test iOS builds before App Store release.

Test:

```text
camera permissions
location permissions
notification permissions
image picker
camera capture
QR scanning
secure session restoration
deep links
keyboard behavior
background/foreground lifecycle
poor network
offline/reconnect
file download/share
map behavior
```

Do not treat Expo web success as proof that native works.

---

# 102. TESTING DOMAIN — NETWORK CONDITIONS

Explicitly test:

```text
fast Wi-Fi
slow cellular
packet loss
temporary disconnect
request timeout
upload interruption
location unavailable
map provider error
tracking update delay
backend 4xx
backend 5xx
```

The UI should recover predictably.

---

# 103. TESTING DOMAIN — SECURITY

Verify:

```text
unauthorized routes cannot expose data
private station information never appears publicly
AI keys are absent from bundles
payment secrets are absent from bundles
KYC media never enters AI transformation
presentation derivatives never become evidence
QR detection does not bypass backend verification
financial state cannot be altered locally
company-managed financial policies cannot be calculated, activated, or overridden locally
```

---

# 104. EAS BUILD DOMAIN

Once the Expo architecture is stable, configure EAS.

Development path:

```text
Expo project
↓
Development build
↓
Install on physical Android/iOS devices
↓
Native capability testing
```

Android device-acceptance path:

```text
Expo React Native
↓
EAS internal/preview build
↓
Installable Android artifact
↓
Physical-device acceptance
```

iOS:

```text
Expo React Native
↓
EAS iOS build
↓
Development/preview distribution
↓
Physical-device acceptance
```

Do not treat Expo Go as the production validation environment.

Use development builds when native modules require them.

---

# 105. BUILD CONFIGURATION DOMAIN

Prepare production configuration for:

```text
application/package identifiers
bundle identifiers
version
build number
app icon
adaptive Android icon
native splash screen
permissions descriptions
deep-link scheme
associated web links where required
notification configuration
environment selection
production backend URL
error monitoring
release channel
EAS profiles
```

Do not accidentally ship development endpoints or secrets.

---

# 106. MIGRATION SEQUENCE

Execute the migration in controlled order:

```text
1. Audit existing Vite/mobile frontend
2. Identify portable logic
3. Establish Expo application
4. Establish providers/session
5. Establish router/workspaces
6. Establish design tokens
7. Establish responsive system
8. Establish core components
9. Establish light/dark themes
10. Establish native capability layer
11. Build visual benchmark screens
12. Validate visual quality
13. Build Customer workspace
14. Build Driver workspace
15. Build Station workspace
16. Integrate media flows
17. Integrate AI presentation frontend
18. Integrate maps/location
19. Integrate live tracking
20. Integrate QR/scanning
21. Integrate evidence flows
22. Integrate notifications
23. Integrate offline/retry behavior
24. Complete responsive web
25. Complete accessibility
26. Complete required journey and device testing
27. Produce Android development/preview build
28. Produce iOS development/preview build
29. Validate Phase 2 completion criteria
```

Do not build 50+ screens before validating the design system.

---

# 107. VISUAL BENCHMARK GATE

Before mass migration, implement production-quality examples of:

### Customer

```text
Welcome
Login/Register
Customer Home
Cylinder List
Cylinder Details
Cylinder Registration
Stations Near You
Station Details
Order Details
Live Tracking
```

### Driver

```text
Driver Home
Current Job
Route to Customer
Pickup
Scan
Route to Station
Return Route
Delivery Verification
Earnings
```

### Station

```text
Station Dashboard
Current Job
Driver Arriving
Scan/Refill
Completion
Settlements
```

Demonstrate them on:

```text
small phone
large phone
tablet
desktop web
```

Do not proceed with mass screen implementation if the benchmark still resembles the poor prototype.

---

# 108. CUSTOMER END-TO-END ACCEPTANCE JOURNEY

The customer production journey should ultimately work using real backend data:

```text
Install/open SKIMA
↓
Authenticate
↓
Customer workspace
↓
Set/select delivery location
↓
Register actual cylinder
↓
Select real cylinder attributes/colour
↓
Upload real cylinder photograph
↓
Original media preserved
↓
AI presentation requested where available
↓
Premium derivative displayed separately
↓
Backend cylinder registration completes
↓
Customer sees cylinder
↓
Customer views QR identity
↓
Customer obtains label where supported
↓
Customer sees nearby stations
↓
Customer opens station details
↓
Customer requests refill
↓
Receives backend quote
↓
Pays through supported method
↓
Order created
↓
Station/driver assignment displayed
↓
Customer tracks fulfillment live
↓
Pickup/refill/return stages update
↓
Delivery confirmed according to backend
↓
Receipt/invoice available
↓
Order appears in history
```

---

# 109. DRIVER END-TO-END ACCEPTANCE JOURNEY

```text
Authenticate
↓
Driver workspace
↓
Approval/capability confirmed
↓
Backend assignment received
↓
Current job displayed
↓
Navigate to customer
↓
Arrival state
↓
Open authorized pickup scan
↓
Scan cylinder
↓
Backend verification
↓
Capture authentic pickup evidence where required
↓
Workflow advances
↓
Navigate to assigned station
↓
Station arrival
↓
Authorized station/refill process
↓
Refill completed
↓
Return route
↓
Navigate to customer
↓
Delivery verification
↓
Backend completion
↓
Driver earnings reflected from backend financial state
```

---

# 110. STATION END-TO-END ACCEPTANCE JOURNEY

```text
Authenticate
↓
Station workspace
↓
Station/staff permission resolved
↓
Relevant assigned job visible
↓
Incoming driver state
↓
Driver arrival
↓
Authorized scan/refill workflow
↓
Authentic evidence/inspection where required
↓
Refill progression
↓
Completion
↓
Driver released for return
↓
Backend settlement state reflected
↓
Station wallet/settlement updated according to backend
```

If station scanning differs from the current backend contract, resolve that backend/product consistency explicitly before production acceptance.

---

# 111. MAPS AND LIVE TRACKING ACCEPTANCE JOURNEY

The maps/tracking domain is not complete until:

```text
customer location resolves correctly
↓
nearby station map/list works
↓
order receives driver/station assignment
↓
customer tracking screen displays real fulfillment state
↓
authorized driver location updates appear
↓
ETA/distance are sourced correctly
↓
driver navigation to customer works
↓
driver navigation to station works
↓
station can see authorized arrival information
↓
driver return navigation works
↓
customer sees return progress
↓
stale/unavailable tracking is represented honestly
↓
completed orders stop presenting themselves as live
```

---

# 112. AI MEDIA ACCEPTANCE JOURNEY

```text
User uploads real public-facing asset
↓
Original persists
↓
Allowed public attributes confirmed
↓
Presentation generation requested
↓
Secure server-side provider integration used
↓
Gemini or configured provider generates derivative
↓
Derivative retains source relationship
↓
UI distinguishes original/presentation purpose
↓
Derivative can appear on approved public/product surfaces
↓
Original remains accessible for authentic use
```

Then verify separately:

```text
KYC document
→ AI unavailable

inspection evidence
→ AI unavailable

pickup evidence
→ AI unavailable

delivery evidence
→ AI unavailable
```

---

# 113. PHASE 2 COMPLETION GATE

The migration is not complete merely because:

```text
npm starts
Expo opens
an APK builds
screens render
```

Production acceptance requires:

```text
real backend integration
real authentication
real authorization
real backend-driven records
native Android functionality
iOS functionality
responsive Expo Web
proper maps
real tracking states
native scanning
correct media separation
AI presentation architecture
secure credential handling
offline resilience
error handling
skeleton loading
light/dark themes
accessibility
responsive QA
end-to-end workflow testing
EAS development/preview configuration where required
```

---

# 114. FINAL NON-NEGOTIABLE IMPLEMENTATION PRINCIPLES

> **Expo React Native is the production SKIMA LPG mobile architecture.**

> **Do not wrap the Vite UI and call the migration complete.**

> **The presentation layer must be genuinely rebuilt using React Native components.**

> **Preserve portable frontend logic and existing backend integration wherever valid.**

> **Do not rewrite or remove valid backend systems simply because the frontend is changing.**

> **If a backend correction or production improvement is genuinely required, document it clearly for approval before making the change.**

> **The backend remains the authority for identity, workflow, permissions, pricing, dispatch, scans, verification and finance.**

> **The ledger remains the financial source of truth.**

> **Company-adjustable financial policy is governed by the [SKIMA Financial Policy Governance Directive](32-financial-policy-governance-directive.md).**

> **The reference journey images establish the visual-quality target but never override backend business logic.**

> **Do not scale mobile screens onto desktop. Recompose them.**

> **Build mobile-first, not mobile-only.**

> **Android, iOS, mobile web, tablet and desktop must each feel intentionally designed.**

> **Customer Home is the first major visual benchmark.**

> **Maps, routing, location, ETA and live tracking are first-class production domains, not decorations.**

> **Never fake tracking data, coordinates, distance or ETA.**

> **Do not create an independent client-side dispatch engine.**

> **Real uploaded media remains authoritative.**

> **AI imagery is a polished presentation derivative, never evidence.**

> **Gemini may be the first image provider, but provider-specific code must remain behind an abstraction.**

> **Never expose Gemini or any private provider credential in the Expo client.**

> **Never AI-transform KYC, regulatory documents, inspection evidence, scan evidence, pickup evidence, damage evidence, refill evidence, incident evidence or delivery evidence.**

> **Public station discovery must expose only intentionally public business information.**

> **The app must never draw fake operating-system elements.**

> **The app must never use believable fake operational records as fallbacks.**

> **Loading, empty, error, offline and permission states are all first-class production states.**

> **A detected QR is not a verified cylinder until the backend confirms it.**

> **A locally queued action is not a completed operational action until the backend acknowledges it.**

> **A generated image is not proof that a physical asset is safe, compliant, inspected or authentic.**

> **No distorted media.**

> **No unreadable dark mode.**

> **No 1,400px-wide mobile forms.**

> **No giant empty cards merely to imitate a hero design.**

> **No mass production of screens until the core design system and benchmark screens have passed visual review.**

> **Do not call the migration production-ready until real Android/iOS builds, responsive web, maps, live tracking, native scanning, real backend workflows, offline behavior and the complete role journeys have all been validated.**


This is the **implementation specification**, not a request for the developer to produce another architecture proposal. The developer should audit the existing frontend against this document, identify portable code, implement the new Expo architecture sequentially, raise only genuine backend corrections for approval, and use these requirements as the acceptance criteria for the finished SKIMA LPG production application.
