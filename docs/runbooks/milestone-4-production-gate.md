# Milestone 4 Production Gate

Milestone 4 builds the reusable frontend foundation and the Phase 1 LPG-first product experience.
Current product work is dedicated to LPG. Future service UI work is paused until the LPG product is
production-ready, launched, and stable.

Current status: In Progress.

Milestone 4 is unblocked by the Milestones 1-3 backend approval recorded on 2026-07-30. Frontend
foundation implementation may begin under this gate.

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
- isolated Phase 1 LPG product composition using reusable primitives

## Entry Evidence

- [x] Milestone 1 backend domain remediation is complete and reviewer-approved.
- [x] Milestone 2 backend domain remediation is complete and reviewer-approved.
- [x] Milestone 3 backend domain remediation is complete and reviewer-approved.
- [x] No-frontend E2E gates cover onboarding, documents, business operations, NGN payment runtime,
      withdrawals, settlements, commissions, communication, OTP, and reconciliation.

## Completion Gate

- [x] Frontend app package exists with a production-capable build command.
- [x] Mobile app package exists with a production-capable build command.
- [x] Design system primitives exist and are reusable.
- [x] Supabase URL and anon key are the only client-side Supabase env values.
- [x] Authentication state is implemented through Supabase client sessions.
- [x] API calls go through a reusable gateway client.
- [x] Route guards are permission-aware and backend-driven.
- [x] Light, dark, and system appearance modes use one shared frontend token system.
- [x] Currency selection is constrained by backend-enabled currencies.
- [x] Loading, empty, and error states are reusable.
- [x] LPG-first mobile navigation is isolated in the Phase 1 product experience.
- [x] Customer mobile navigation is focused on `Home`, `Cylinders`, `Orders`, `Wallet`, and
      `Account`.
- [x] Uploaded LPG customer, driver, and station visual references are archived under
      `docs/lpg-ui/assets`.
- [x] LPG screen-by-screen product documentation exists under `docs/lpg-ui/`.
- [x] Mobile app signs in with Supabase Auth and loads `/runtime/session-context`.
- [x] Mobile app renders role-aware live data from gateway routes for wallets, orders, service
      requests, assignments, drivers, vehicles, branches, catalog items, applications, documents,
      messages, and business lines.
- [x] Mobile Control Center can register cylinders, save LPG addresses, create LPG refill quotes,
      start applications, begin wallet funding, request and fetch in-app OTP codes, start tracking,
      and record verification checks through governed gateway actions.
- [ ] Mobile write flows for onboarding, applications, documents, payments, orders, dispatch,
      verification, tracking, and profile operations are implemented.
- [ ] Mobile QR camera, map rendering, uploads, and responsive/device E2E gates are implemented.
- [x] Admin application and document review actions use authenticated gateway mutations.
- [x] Admin governance, organization, catalog, operations, finance, integration, communication, OTP,
      escrow, settlement, commission, and reconciliation controls are wired through governed gateway
      actions.
- [x] LPG-only UI logic is isolated outside shared foundation primitives.
- [x] `npm run verify` passes.
- [x] Frontend build passes.
- [x] Hosted session-context smoke gate passes.
- [x] Documentation is updated.
- [ ] Reviewer approves Milestone 4 evidence.

# MILESTONE 4 - PRODUCTION-GRADE REUSABLE FRONTEND DIRECTIVE

Milestone 4 must deliver a **production-grade, reusable frontend foundation**.

The goal is not merely to create screens that work.

The goal is to create a high-quality frontend system that can support:

- Customers
- Drivers
- Partners
- Administrators
- LPG
- Restaurants
- Ride hailing
- Courier services
- Marketplaces
- Future business modules

without rebuilding the frontend foundation for each experience.

The frontend must be:

- Reusable
- Modular
- Accessible
- Responsive
- Consistent
- Maintainable
- Secure
- Performant
- API-driven
- Permission-aware
- Production-ready

---

# 1. REUSABILITY IS NON-NEGOTIABLE

Do not create independent UI elements for individual screens.

Do not create:

- One button component for the customer app
- Another button component for the driver app
- Another button component for the partner dashboard
- Another button component for the admin dashboard

Build one reusable Button system with configurable:

- Variants
- Sizes
- Icons
- Loading states
- Disabled states
- Destructive states
- Permission-aware behavior
- Accessibility attributes

Apply the same principle to every frontend element.

---

# 2. BUILD SYSTEMS, NOT ISOLATED COMPONENTS

Do not create isolated elements without a shared design contract.

Build reusable systems for:

## Buttons

- Primary
- Secondary
- Outline
- Ghost
- Destructive
- Icon-only
- Loading
- Disabled

## Inputs

- Text
- Number
- Currency
- Phone
- Email
- Password
- Search
- Date
- Time
- Location
- File upload
- Select
- Multi-select
- Toggle
- Checkbox
- Radio

## Forms

- Shared validation behavior
- Reusable field wrappers
- Labels
- Helper text
- Error messages
- Async submission states
- Success states
- Form-level errors
- Accessible focus behavior

## Tables and Lists

- Loading states
- Empty states
- Error states
- Pagination
- Sorting
- Filtering
- Search
- Row actions
- Bulk actions
- Responsive layouts
- Permission-aware actions

## Dialogs and Overlays

- Confirmation dialog
- Form dialog
- Destructive-action dialog
- Drawer
- Bottom sheet
- Popover
- Tooltip
- Command palette

## Feedback

- Toasts
- Alerts
- Inline messages
- Banners
- Progress indicators
- Skeletons
- Retry actions

Every component must be designed for reuse across multiple roles and business modules.

---

# 3. NO BUSINESS-SPECIFIC FOUNDATION COMPONENTS

Do not create foundation components such as:

- `LPGOrderButton`
- `GasStationCard`
- `CylinderStatusBadge`
- `RestaurantOrderTable`
- `RideDriverMap`
- `PharmacyPaymentDialog`

Those are business-module components.

Foundation components should instead be generic:

- `ActionButton`
- `PartnerCard`
- `AssetCard`
- `StatusBadge`
- `OrderTable`
- `TrackingMap`
- `PaymentDialog`
- `WorkflowTimeline`

Business modules may configure or compose these generic components.

They must not duplicate them.

---

# 4. COMPOSITION OVER DUPLICATION

The frontend should be assembled through composition.

For example:

```text
Generic Page Shell
        ↓
Generic Data Query
        ↓
Generic Table
        ↓
Configured Columns
        ↓
Permission-Aware Actions
        ↓
Module-Specific Data
```

A new service should primarily define:

- Data source
- Labels
- Fields
- Columns
- Permissions
- Workflow states
- Actions
- Validation rules
- Display configuration

It should not rebuild navigation, forms, tables, dialogs, cards, maps or loading states.

---

# 5. DESIGN SYSTEM REQUIREMENT

Create a documented design system before building business screens.

It must include:

- Color tokens
- Typography tokens
- Spacing scale
- Border-radius scale
- Shadows
- Elevation
- Icon sizing
- Breakpoints
- Motion rules
- Focus states
- Disabled states
- Error states
- Success states
- Warning states
- Information states
- Light theme
- Dark theme if included
- Accessibility contrast requirements

Do not scatter raw style values throughout components.

Avoid repeated values such as:

```css
padding: 16px;
border-radius: 8px;
color: #123456;
```

Use shared tokens instead.

---

# 6. APPLICATION SHELL

Build a reusable application shell that supports different experiences.

The shell must support:

- Top navigation
- Sidebar navigation
- Bottom mobile navigation
- Breadcrumbs
- Page headers
- Global search
- Notifications
- Account menu
- Context switching
- Responsive layouts
- Permission-based navigation
- Module-based navigation
- Loading boundaries
- Error boundaries

The shell must not assume one user role.

It must adapt based on backend-provided:

- Role
- Permissions
- Organization
- Active module
- Features
- Navigation configuration

---

# 7. ROUTING

Routing must be structured and permission-aware.

Required behavior:

- Public routes
- Authenticated routes
- Role-restricted routes
- Permission-restricted routes
- Module-enabled routes
- Feature-flagged routes
- Not-found routes
- Unauthorized routes
- Session-expired handling
- Redirect handling

Do not hardcode access decisions only in frontend route files.

The backend remains the authority.

The frontend may hide or disable inaccessible features, but backend APIs must still enforce
authorization.

---

# 8. AUTHENTICATION AND SESSION STATE

Use Supabase client sessions safely.

Only client-safe environment variables may be exposed:

- Supabase URL
- Supabase anon key

Never expose:

- Service-role key
- Database credentials
- Payment secrets
- AI provider secrets
- Map provider server secrets
- Webhook secrets
- Admin credentials

Build a reusable session provider that supports:

- Initial session loading
- Login
- Logout
- Token refresh
- Session expiration
- User profile loading
- Permission loading
- Organization loading
- Loading state
- Error state
- Redirect after authentication

---

# 9. API GATEWAY CLIENT

All frontend API calls must use a reusable API gateway client.

Do not call Edge Functions independently from random components.

The gateway client must provide:

- Authentication headers
- Request IDs
- Timeouts
- Standard response parsing
- Typed responses
- Structured errors
- Retry policy where appropriate
- Cancellation
- Unauthorized handling
- Rate-limit handling
- Logging in development
- Safe error messages in production

Business components should call application hooks or services, not manually construct API requests.

---

# 10. DATA ACCESS LAYER

Use a consistent frontend data-access pattern.

Build reusable:

- Query hooks
- Mutation hooks
- Cache keys
- Pagination models
- Filtering models
- Sorting models
- Optimistic-update rules
- Invalidation rules
- Retry rules
- Error normalization

Do not scatter data fetching inside visual components.

Separate:

- Presentation
- Data access
- Domain transformation
- Permissions
- Validation
- Navigation

---

# 11. RUNTIME VALIDATION

TypeScript types alone are not enough.

All important API responses must be validated at runtime.

The frontend must safely handle:

- Missing fields
- Unexpected fields
- Invalid enum values
- Null values
- Outdated API responses
- Partial responses
- Network failures
- Authorization failures
- Validation failures
- Backend errors

Do not trust external or backend data merely because a TypeScript interface exists.

---

# 12. LOADING, EMPTY AND ERROR STATES

Every data-driven component must define:

- Initial loading state
- Background refresh state
- Empty state
- Permission-denied state
- Not-found state
- Validation-error state
- Server-error state
- Offline or network-error state
- Retry state
- Partial-data state

Do not create custom loading and error components independently for every screen.

Use shared reusable state components.

Examples:

- `LoadingState`
- `PageSkeleton`
- `EmptyState`
- `ErrorState`
- `PermissionDeniedState`
- `NotFoundState`
- `RetryPanel`

---

# 13. RESPONSIVE DESIGN

The frontend must be production-ready across:

- Mobile phones
- Tablets
- Laptops
- Desktop monitors
- Wide admin displays

Do not build desktop-only dashboards and postpone responsiveness.

Responsive behavior must be part of every reusable component.

Tables must have mobile behavior.

Dialogs must adapt to smaller screens.

Navigation must support desktop and mobile variants.

Forms must remain usable on low-width devices.

---

# 14. ACCESSIBILITY

Accessibility is required, not optional.

Implement:

- Semantic HTML
- Keyboard navigation
- Visible focus states
- Correct labels
- ARIA attributes where required
- Screen-reader-friendly errors
- Accessible dialogs
- Accessible menus
- Accessible forms
- Sufficient color contrast
- Reduced-motion support
- Logical tab order

Reusable components must carry accessibility behavior so every future screen inherits it
automatically.

---

# 15. PERFORMANCE

Production quality requires performance discipline.

Implement:

- Route-level code splitting
- Lazy loading
- Image optimization
- Bundle analysis
- Memoization where justified
- Avoidance of unnecessary re-renders
- Efficient list rendering
- Pagination or virtualization for large datasets
- Request deduplication
- Cache management
- Loading boundaries
- Error boundaries

Do not optimize blindly, but do not ignore obvious performance risks.

---

# 16. MAP AND TRACKING UI

Do not rebuild map logic in the frontend.

Create reusable visual components that consume completed backend services.

Examples:

- `MapView`
- `LocationMarker`
- `RouteLayer`
- `TrackingMap`
- `LocationPicker`
- `GeofenceEditor`
- `ETAIndicator`
- `TrackingStatus`

These components must not contain LPG-specific logic.

They should receive normalized platform data from the backend.

---

# 17. FINANCIAL UI

Create reusable financial components such as:

- `MoneyDisplay`
- `WalletBalance`
- `TransactionList`
- `PaymentStatus`
- `SettlementBreakdown`
- `EscrowStatus`
- `RefundStatus`
- `CurrencySelector`

Do not assume only NGN in component logic.

The backend may initially enable NGN only, but the frontend components should support currency codes
and formatting generically.

---

# 18. PERMISSION-AWARE UI

Permissions must be reusable and backend-driven.

Build:

- Permission hooks
- Permission guards
- Permission-aware navigation
- Permission-aware action buttons
- Permission-aware menus
- Permission-aware routes
- Appearance preference controls for light, dark, and system modes
- Currency preference controls from the backend Currency Engine

Examples:

```text
Can the user view this page?
Can the user see this action?
Can the user edit this record?
Can the user activate this module?
Can the user manage settlements?
```

Do not duplicate permission checks across components.

Use a shared permission system.

---

# 19. QUALITY REQUIREMENTS

Every reusable component must have:

- Clear API
- Typed props
- Accessible behavior
- Loading behavior where relevant
- Error behavior where relevant
- Responsive behavior
- Tests
- Documentation
- Examples or stories where appropriate

Do not mark a component complete because it renders visually.

It must also behave correctly.

---

# 20. TESTING REQUIREMENT

Milestone 4 must include:

## Unit Tests

- Component states
- Validation behavior
- Permission behavior
- Utility functions
- Runtime schema validation
- Error normalization

## Integration Tests

- Authentication
- Session restoration
- Protected routes
- API gateway client
- Permission-aware navigation
- Form submission
- Loading and error states

## End-to-End Tests

- Login
- Logout
- Session expiration
- Unauthorized route access
- Navigation by permission
- API failure handling
- Responsive critical flows

Visual regressions should be considered for important reusable components.

---

# 21. DOCUMENTATION

Update or create:

- Frontend architecture
- Design system
- Component inventory
- Component usage rules
- Routing model
- Authentication integration
- API client documentation
- Runtime validation
- Permission model
- Error-handling model
- Responsive design rules
- Accessibility requirements
- Testing strategy
- Milestone evidence
- Known limitations
- Production-readiness checklist

Documentation must match actual implementation.

---

# 22. COMPLETION GATE

Milestone 4 must not be approved until:

- The frontend package builds successfully.
- The production build command works.
- The reusable application shell exists.
- The design-token system exists.
- Reusable UI primitives exist.
- Authentication sessions work.
- API access uses the shared gateway client.
- Runtime response validation exists.
- Route guards are permission-aware.
- Navigation is backend-driven.
- Light, dark, and system appearance modes are implemented with one token system.
- Currency preference is populated from backend-enabled currencies.
- Loading, empty and error states are reusable.
- Responsive behavior is verified.
- Accessibility requirements are tested.
- No LPG-specific logic exists in the foundation.
- No duplicated independent UI systems exist.
- `npm run verify` passes.
- Automated tests pass.
- Documentation is updated.
- Reviewer evidence is produced.
- Reviewer approves the milestone.

---

# FINAL INSTRUCTION

Do not rush into building visible business screens.

A few attractive screens built with duplicated components do not represent production progress.

The correct objective is to build a reusable frontend operating system first.

Every future screen should be assembled from the same:

- Design tokens
- Layouts
- Navigation
- Forms
- Tables
- Dialogs
- Cards
- State components
- Permission system
- API client
- Data-access patterns
- Map components
- Financial components

Build once.

Compose everywhere.

Do not create independent UI elements when a reusable system can serve the entire platform.
