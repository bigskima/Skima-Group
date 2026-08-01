# Design System

Current status: In Progress.

The reusable design system lives in `packages/ui`.

## Tokens

Tokens are centralized in `packages/ui/src/styles.css`.

Current token groups:

- colors
- typography
- spacing
- radius
- shadows
- focus state
- semantic tones
- responsive shell behavior
- reduced-motion behavior

Raw visual values should not be scattered through app screens.

The current visual language uses a neutral operational base with teal, indigo, amber, success, and
danger accents. This keeps admin and mobile surfaces energetic without locking the platform into a
single service color or business type.

## Component Inventory

Implemented foundation primitives:

- `Button`
- `IconButton`
- `TextInput`
- `TextAreaInput`
- `SelectInput`
- `CheckboxField`
- `Field`
- `StatusBadge`
- `StatePanel`
- `LoadingState`
- `EmptyState`
- `ErrorState`
- `PermissionDeniedState`
- `PermissionGate`
- `PageShell`
- `PageHeader`
- `DataTable`
- `DetailList`
- `Dialog`
- `MetricTile`
- `OnboardingChecklist`
- `WorkflowTimeline`
- `MoneyDisplay`
- `ToastViewport`

All foundation components are business-agnostic. Module-specific components must compose these
primitives instead of duplicating them.

## Accessibility

The initial foundation includes:

- semantic buttons and forms
- `aria-label` support for icon buttons
- visible focus styles
- dialog `role="dialog"` and `aria-modal`
- loading `role="status"`
- field error `role="alert"`
- reduced-motion media query
- mobile bottom navigation labels

Full accessibility testing remains required before Milestone 4 completion.

## Responsive Behavior

The shell supports desktop sidebar navigation and mobile bottom navigation. Tables are horizontally
scrollable on medium screens and convert into labeled record cards on narrow mobile screens. Form
controls keep stable touch-friendly dimensions. Review panels collapse from two columns to one
column on narrow screens, and detail lists stack cleanly so long IDs and review notes do not overlap
adjacent content.

Mobile surfaces must use the same spacing, radius, status, and color semantics. Native mobile
components may be implemented separately, but their props and behavior should map back to the shared
foundation.

## Admin Operation Composition

The application review surface uses shared primitives instead of private controls:

- queue items compose panel, status badge, and action styles
- review forms use `Dialog`, `TextAreaInput`, and `Button`
- record metadata uses `DetailList`
- guarded actions use permission-aware buttons

The broader admin console uses the same composition rules:

- resource areas use reusable tab controls styled by shared tokens
- action buttons use shared variants and permission checks
- action forms use shared field, select, textarea, checkbox, dialog, and status components
- record lists use the shared `DataTable`
- sensitive actions use destructive button styling and backend-enforced policies

Future customer, partner, driver, and module screens should reuse these patterns instead of creating
separate UI systems.

## Icon Policy

Interactive controls use Lucide icons through `lucide-react` where an icon exists.

## Business-Specific Boundaries

Forbidden foundation patterns:

- LPG-only buttons, cards, badges, or forms
- restaurant-only tables
- ride-hailing-only map components
- duplicate button/input/table systems per role

Business modules may provide configuration, labels, schemas, actions, and columns that compose the
shared foundation.
