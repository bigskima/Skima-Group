# LPG Visual Standard

Current status: In Progress.

The LPG app must feel premium, focused, fast, and safe. The references show a clean white Skima
product with strong red actions, soft cards, product imagery, and role-specific bottom navigation.

## Brand Direction

Use Skima red as the primary action color and brand anchor. The interface should be mostly light,
with red used for action, active state, attention, and product identity.

Required visual characteristics:

- white or near-white screen background
- black/navy primary text
- muted gray secondary text
- Skima red primary buttons, active tabs, selected nav items, and critical accents
- soft red panels for LPG product cards and wallet cards
- subtle borders and shadows on individual cards
- clear green success states for verified, completed, active, and paid statuses
- amber warning states for inspection due, pending scan, and processing states
- blue/purple only for secondary informational or category indicators

Avoid:

- dull admin-table styling for mobile users
- oversized generic marketing blocks after login
- raw JSON, ids, or backend terminology in visible user copy
- decorative gradients that do not carry product information
- generic service-category grids for Phase 1 customer screens

## Theme Rules

The app supports:

- light mode
- dark mode
- system mode

Users may choose those appearance modes from settings. Users must not customize arbitrary brand
colors. Skima brand tokens are controlled by the design system and platform configuration, not by
per-user color pickers.

Currency display is separate from theme. The currency selector must read enabled currencies from
the backend Currency Engine. Phase 1 exposes NGN only unless an admin enables another currency
through backend configuration.

## Layout Rules

Mobile screens should follow this structure:

- status bar-safe top spacing
- a clear title/header area
- one primary screen intent above the fold
- section cards for repeated objects only
- 16px to 24px horizontal page padding
- persistent bottom navigation for authenticated workspaces
- floating center scan tab where scan is a core role action
- stable touch targets of at least 44px
- large primary actions near the bottom of the active task when possible

Cards should feel modern but not bubbly:

- 16px to 24px radius for mobile product cards
- 8px to 12px radius for buttons, fields, chips, and compact controls
- restrained shadows
- visible borders on white cards
- no nested decorative cards unless the inner card is a repeated item or control surface

## Typography

Use a compact, readable hierarchy:

- screen title: bold, prominent, not oversized
- card title: bold, scannable
- amounts: large, strong, monospaced only if the design system supports it
- metadata: muted and compact
- buttons: semibold and centered
- status chips: short and direct

Do not use hero-scale text inside dense mobile cards.

## Core Component Families

The LPG product layer must compose these reusable component families:

- `MobileShell`
- `WorkspaceSwitcher`
- `BottomNavigation`
- `ActionButton`
- `IconButton`
- `SegmentedControl`
- `StatusChip`
- `MetricCard`
- `WalletCard`
- `MoneyDisplay`
- `LpgProductHero`
- `AssetCard`
- `CylinderCard`
- `OrderCard`
- `OrderProgressStepper`
- `WorkflowTimeline`
- `TrackingMap`
- `RouteSummary`
- `QrScanSurface`
- `OtpCodeInput`
- `TransactionList`
- `DocumentUploadList`
- `ApplicationStepper`
- `SettingsList`
- `PermissionGate`
- `LoadingState`
- `EmptyState`
- `ErrorState`
- `SuccessState`

Foundation components must stay business-agnostic. LPG-specific components may wrap shared
components in `apps/mobile/src/lpg` or a similar product-layer folder.

## Image And Media Rules

The app needs real visual assets:

- Skima logo
- LPG cylinder images in multiple sizes
- station illustration or generated station image
- wallet image
- driver avatar fallback
- vehicle images
- QR/scan imagery
- map tiles or map preview rendering from backend-normalized provider data

Images must be treated as product assets. Do not replace them with plain icons where the reference
clearly depends on product imagery.

Media should be served through the backend Media/Storage engines once production assets are
available. Local static assets may be used for early frontend composition only when clearly marked
as launch placeholders.

## Motion And Feedback

Use motion sparingly:

- button press feedback
- sheet transitions
- tab transitions
- scan frame pulse
- success check animation
- order progress change animation
- loading skeletons

Respect reduced-motion settings.

## Accessibility

Every screen must support:

- readable contrast in light and dark mode
- semantic labels for icon-only controls
- screen-reader labels for status chips and money values
- visible focus states
- keyboard-friendly forms for web builds
- error text tied to fields
- non-color status cues, such as icons or text

## Production Rejection Criteria

A screen should be rejected if it:

- looks like a raw admin form instead of a finished mobile product
- uses generic service tiles on the Phase 1 customer home
- hides critical order status below long forms
- exposes internal ids without user-friendly labels
- has LPG logic inside shared foundation primitives
- has no loading, empty, error, permission, or offline state
- has no dark-mode equivalent
- cannot be used comfortably on a small phone

