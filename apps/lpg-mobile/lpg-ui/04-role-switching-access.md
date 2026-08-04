# Role Switching And Access

Current status: In Progress.

Skima users can hold more than one workspace. A person may be a customer, approved driver, station
owner, station staff member, and platform admin. The UI must support moving between allowed
workspaces without exposing actions that the backend has not authorized.

## Workspace Model

The app should display only workspaces returned by backend session context:

- Customer
- Driver
- Station
- Admin

Customer access is the default for signed-in users. Driver and station access appear only after
application approval or staff invitation acceptance. Admin access appears only for platform admins.

## Switching Rules

Required behavior:

- the current workspace is selected from backend-approved contexts
- switching workspace refreshes navigation, permissions, organization context, branch context, and
  visible actions
- the selected workspace can be remembered locally, but must be revalidated on every session load
- revoked or suspended access must remove the workspace immediately after session-context refresh
- if a user loses access while inside a workspace, show a permission-denied state and move them to
  an allowed workspace

Never trust a locally stored workspace as authorization.

## Navigation By Workspace

Customer:

- Home
- Cylinders
- Orders
- Wallet
- Account

Driver:

- Home
- Jobs
- Scan
- Earnings
- Account

Station:

- Dashboard
- Jobs
- Scan
- Settlements
- Account

Admin:

- Overview
- Applications
- Operations
- Finance
- Modules
- Users
- Integrations
- Audit

The mobile interface may prioritize customer, driver, and station tabs. Admin can remain optimized
for wider web/admin screens unless a mobile admin shell is explicitly required.

## Permission-Aware UI

The frontend may hide or disable:

- settlement values
- withdrawal actions
- staff management
- price editing
- scan controls
- manual override controls
- report and export controls
- refund/release/top-up operations
- provider configuration
- admin-only review actions

The backend must still enforce every action. UI visibility is convenience, not security.

## Account Screen Entry Points

The customer account screen is the primary route into:

- Apply as Driver
- Register Your Station
- Vehicle registration
- Station application
- Support
- Settings

After approval, the account screen should show a workspace switcher or role cards that let the user
enter Driver or Station mode.

## Settings

Settings must include:

- light, dark, and system appearance mode
- backend-enabled currency display choices
- notification preferences
- security/session controls
- support and help
- document/application status where relevant

Settings must not expose:

- service-role keys
- provider API keys
- webhook secrets
- payment secrets
- admin credentials
- arbitrary brand color controls

## Production Gate

Role switching is production-ready only when:

- session context drives available workspaces
- navigation changes correctly by workspace
- branch restrictions are enforced for station staff
- suspended or revoked users lose access
- restricted actions are blocked by backend and represented clearly in UI
- tests cover customer-only, driver-approved, station-owner, station-staff, and admin contexts

