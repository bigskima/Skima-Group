# LPG Screen Build Backlog

Current status: In Progress.

This backlog defines the build order for the LPG mobile product. It keeps the team from building
random forms and helps every screen reach the uploaded reference quality.

## A. Product Assets And Tokens

Build first:

- Skima logo asset
- LPG cylinder image set: 3kg/5kg/6kg/12.5kg/15kg/25kg/50kg where available
- station image or generated launch illustration
- wallet image
- driver avatar fallback
- vehicle image set
- QR scan frame visual
- map placeholder and map provider rendering states
- light and dark token mappings

Acceptance:

- assets render sharply on mobile
- no important screen depends on generic placeholder icons only
- dark mode uses the same component system

## B. Shared Mobile Foundation

Build:

- `MobileShell`
- `BottomNavigation`
- `WorkspaceSwitcher`
- `ScreenHeader`
- `MetricCard`
- `WalletCard`
- `StatusChip`
- `OrderCard`
- `CylinderCard`
- `Timeline`
- `Stepper`
- `TrackingMap`
- `QrScanSurface`
- `OtpInput`
- `ActionSheet`
- `FormStep`
- `EmptyState`
- `ErrorState`
- `SuccessState`

Acceptance:

- no duplicate customer/driver/station button systems
- no hardcoded provider secrets or admin-only data in the client
- all API calls use the shared gateway client

## C. Customer App

Build in this order:

1. Onboarding welcome.
2. Register/sign in.
3. OTP verification.
4. Profile setup.
5. Customer home.
6. Cylinder registry.
7. Register cylinder flow.
8. Refill order stepper.
9. Price breakdown.
10. Payment selection.
11. Order placed.
12. Active order tracking.
13. Fulfilment status screens.
14. Invoice and rating.
15. Wallet.
16. Account.
17. Apply as driver.
18. Register station.

Acceptance:

- a customer can complete the LPG refill lifecycle without seeing unrelated services
- price and wallet values come from backend
- order state is workflow-driven
- OTP/QR verification is backend-driven

## D. Driver App

Build in this order:

1. Driver application entry from account.
2. Driver profile setup.
3. Vehicle registration.
4. Document upload.
5. Approval status.
6. Driver home.
7. Available jobs.
8. Job details.
9. Accept/decline job.
10. Navigate to customer.
11. Pickup scan.
12. Navigate to station.
13. Wait for station scan/refill.
14. Return to customer.
15. Delivery OTP/QR verification.
16. Job completed.
17. Earnings breakdown.
18. Earnings history.
19. Driver account.

Acceptance:

- only approved drivers and vehicles receive LPG jobs
- scan and delivery verification are auditable
- earnings match ledger/commission records

## E. Station App

Build in this order:

1. Station application entry from account.
2. Register station.
3. Station details.
4. Document upload.
5. Approval status.
6. Station dashboard.
7. Incoming jobs.
8. Job details.
9. Driver arriving.
10. Cylinder scan.
11. Refilling in progress.
12. Refill completed.
13. Order completion/settlement release.
14. Settlements.
15. Transactions and payouts.
16. Inventory and stock.
17. Staff and roles.
18. Station settings.
19. Reports.
20. More/account.

Acceptance:

- scanner and pump attendant roles see only allowed features
- station settlement values are protected by permissions
- stock and availability affect customer ordering
- every refill action writes workflow/event/audit records

## F. Admin Console Alignment

Admin should continue supporting:

- application review
- user status and suspension
- station/driver verification
- finance and refunds
- settlements and withdrawals
- provider adapters
- module configuration
- audit and reconciliation

The admin UI should be polished separately for operational density. It does not need to mimic the
mobile product cards, but it must not look unfinished or expose internal build terms.

## G. Tests And Evidence

Before reviewer approval:

- mobile build passes
- frontend validation passes
- customer journey smoke test passes
- driver journey smoke test passes
- station journey smoke test passes
- role switching test passes
- light/dark visual checks pass
- permission-denied states are tested
- empty and loading states are tested
- screenshots are captured for the evidence folder

