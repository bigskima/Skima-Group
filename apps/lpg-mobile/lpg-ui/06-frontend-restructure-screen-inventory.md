# LPG Mobile Frontend Restructure And Screen Inventory

Status: Active architecture contract.

This document is the implementation ledger for the approved LPG mobile references. It separates
bottom tabs from nested workflow routes, keeps shared business behavior in feature modules, and
keeps Skima company administration in the existing web admin application.

## Final Source Tree

```text
apps/lpg-mobile/src/
  app/
    App.tsx
    providers/
      AppProviders.tsx
      QueryProvider.tsx
      SessionProvider.tsx
      ThemeProvider.tsx
    router/
      AppRouter.tsx
      AuthenticatedRouter.tsx
      PublicRouter.tsx
    guards/
      AuthenticationGuard.tsx
      PermissionGuard.tsx
      WorkspaceGuard.tsx
    shell/
      MobileShell.tsx
      WorkspaceSelector.tsx
  workspaces/
    customer/
      navigation/
      screens/{home,cylinders,orders,wallet,account}/
    driver/
      navigation/
      screens/{home,jobs,scan,earnings,account}/
    station/
      navigation/
      screens/{dashboard,jobs,scan,settlements,account}/
  features/
    auth/ onboarding/ applications/ cylinders/ orders/ dispatch/
    scanning/ verification/ tracking/ maps/ wallet/ payments/
    settlements/ commissions/ notifications/ permissions/ media/
    profiles/ vehicles/ stations/
  shared/
    api/ hooks/ schemas/ types/ ui/ utilities/ validation/
```

## Bottom Tabs And Nested Routes

| Workspace | Bottom tab | Root route | Nested routes |
| --- | --- | --- | --- |
| Customer | Home | `/customer/home` | active-order summary and quick actions |
| Customer | Cylinders | `/customer/cylinders` | `:cylinderId`, `register`, `register/photo` |
| Customer | Orders | `/customer/orders` | `:orderId`, `:orderId/tracking`, `:orderId/delivery-verification`, `:orderId/invoice`, `:orderId/review` |
| Customer | Wallet | `/customer/wallet` | `top-up`, `transactions`, `payment-methods` |
| Customer | Account | `/customer/account` | `addresses`, `notifications`, `support`, `partner-routes`, `applications/:applicationId` |
| Driver | Home | `/driver/home` | `availability` |
| Driver | Jobs | `/driver/jobs` | `:jobId`, `:jobId/customer-route`, `:jobId/customer-arrival`, `:jobId/pickup`, `:jobId/station-route`, `:jobId/station-handoff`, `:jobId/return`, `:jobId/delivery`, `:jobId/completed` |
| Driver | Scan | `/driver/scan` | `result` |
| Driver | Earnings | `/driver/earnings` | `transactions`, `withdraw` |
| Driver | Account | `/driver/account` | `profile`, `vehicle`, `documents`, `service-zone` |
| Station | Dashboard | `/station/dashboard` | incoming-job summary |
| Station | Jobs | `/station/jobs` | `:jobId`, `:jobId/driver-arrival`, `:jobId/refill`, `:jobId/refill-complete`, `:jobId/delivered` |
| Station | Scan | `/station/scan` | `result`, `inspection`, `actual-kilograms` |
| Station | Settlements | `/station/settlements` | `transactions`, `payouts`, `withdraw` |
| Station | Account | `/station/account` | `profile`, `inventory`, `staff`, `roles`, `permissions`, `settings`, `reports`, `documents` |

## Complete Reference Screen Inventory

`Owned` means a dedicated workspace screen exists after the restructure. `Missing` means the
approved reference has no production implementation yet and must not be represented by fake data.

| Reference screen | Workspace | Bottom tab | Nested route | Component file | Required API | Required permission | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Welcome | Public | - | `/welcome` | `features/onboarding/screens/WelcomeScreen.tsx` | Supabase Auth session | Public | Owned |
| Register / Sign Up | Public | - | `/register` | `features/auth/screens/RegisterScreen.tsx` | Supabase Auth | Public | Missing |
| Verify Phone OTP | Public | - | `/verify-phone` | `features/auth/screens/VerifyPhoneScreen.tsx` | `/runtime/otp/challenges`, `/runtime/otp/delivery` | Authenticated challenge owner | Missing |
| Set Up Profile | Customer | Account | `/customer/account/profile-setup` | `features/profiles/screens/ProfileSetupScreen.tsx` | `/runtime/session-context`, profile API | Authenticated | Missing |
| Onboarding Complete | Customer | Home | `/customer/onboarding-complete` | `features/onboarding/screens/OnboardingCompleteScreen.tsx` | `/runtime/session-context` | Authenticated | Missing |
| Customer Home Dashboard | Customer | Home | `/customer/home` | `workspaces/customer/screens/home/CustomerHomeScreen.tsx` | `/lpg/cylinders`, `/lpg/orders/active`, `/lpg/quotes`, `/lpg/locations`, `/runtime/wallet-balances`, `/runtime/communications/messages` | Record ownership | Owned |
| Select Cylinder And Kg | Customer | Orders | `/customer/orders/new` | `features/orders/screens/CreateRefillQuoteScreen.tsx` | `/lpg/config`, `/lpg/cylinders`, `/lpg/locations`, `/lpg/quotes` | Cylinder owner | Missing |
| Delivery Address | Customer | Account | `/customer/account/addresses` | `workspaces/customer/screens/account/AddressesScreen.tsx` | `/lpg/locations`, `/lpg/maps/autocomplete`, `/lpg/maps/geocode` | Location owner | Missing |
| Price Breakdown | Customer | Orders | `/customer/orders/new/review` | `features/orders/screens/QuoteReviewScreen.tsx` | `/lpg/quotes` | Quote owner | Missing |
| Payment Selection | Customer | Wallet | `/customer/orders/new/payment` | `features/payments/screens/OrderPaymentScreen.tsx` | `/runtime/wallet-balances`, `/lpg/orders`, `/lpg/orders/reserve-payment` | Order owner | Missing |
| Order Placed | Customer | Orders | `/customer/orders/:orderId/placed` | `features/orders/screens/OrderPlacedScreen.tsx` | `/lpg/orders` | Order owner | Missing |
| Track Order Live | Customer | Orders | `/customer/orders/:orderId/tracking` | `workspaces/customer/screens/orders/CustomerLiveTrackingScreen.tsx` | `/lpg/orders/active`, `/lpg/maps/route-estimate` | Order owner | Missing |
| Driver Arrived / Pickup | Customer | Orders | `/customer/orders/:orderId` | `workspaces/customer/screens/orders/CustomerOrderDetailsScreen.tsx` | `/lpg/orders/active`, `/lpg/scans` | Order owner | Owned |
| At Station | Customer | Orders | `/customer/orders/:orderId` | `workspaces/customer/screens/orders/CustomerOrderDetailsScreen.tsx` | `/lpg/orders/active`, `/lpg/inspections` | Order owner | Owned |
| Out For Delivery | Customer | Orders | `/customer/orders/:orderId/tracking` | `workspaces/customer/screens/orders/CustomerLiveTrackingScreen.tsx` | `/lpg/orders/active`, `/lpg/maps/route-estimate` | Order owner | Missing |
| Delivered | Customer | Orders | `/customer/orders/:orderId/delivery-verification` | `workspaces/customer/screens/orders/DeliveryVerificationScreen.tsx` | `/lpg/orders/delivery-challenge`, `/lpg/scans` | Customer or verified challenge | Missing |
| Rate And Review | Customer | Orders | `/customer/orders/:orderId/review` | `features/orders/screens/OrderReviewScreen.tsx` | Review API required | Order owner | Missing API |
| Invoice | Customer | Orders | `/customer/orders/:orderId/invoice` | `features/orders/screens/OrderInvoiceScreen.tsx` | `/lpg/orders/financial-summary` | Order owner | Missing |
| Order History | Customer | Orders | `/customer/orders` | `workspaces/customer/screens/orders/CustomerOrdersScreen.tsx` | `/lpg/orders` | Record ownership | Owned |
| Wallet | Customer | Wallet | `/customer/wallet` | `workspaces/customer/screens/wallet/CustomerWalletScreen.tsx` | `/runtime/wallet-balances`, `/runtime/payments/deposits`, `/runtime/withdrawals` | Wallet owner | Owned |
| Add Money | Customer | Wallet | `/customer/wallet/top-up` | `workspaces/customer/screens/wallet/TopUpScreen.tsx` | `/runtime/payments/deposits` | Wallet owner | Missing |
| Payment Methods | Customer | Wallet | `/customer/wallet/payment-methods` | `workspaces/customer/screens/wallet/PaymentMethodsScreen.tsx` | Provider-backed payment-method API required | Wallet owner | Missing API |
| Addresses | Customer | Account | `/customer/account/addresses` | `workspaces/customer/screens/account/AddressesScreen.tsx` | `/lpg/locations` | Location owner | Missing |
| Saved Cylinders | Customer | Cylinders | `/customer/cylinders` | `workspaces/customer/screens/cylinders/CustomerCylindersScreen.tsx` | `/lpg/cylinders`, `/lpg/cylinders/history` | Cylinder owner | Owned |
| Notifications | Customer | Account | `/customer/account/notifications` | `workspaces/customer/screens/account/NotificationsScreen.tsx` | `/runtime/communications/messages` | Recipient | Missing |
| Customer Account | Customer | Account | `/customer/account` | `workspaces/customer/screens/account/CustomerAccountScreen.tsx` | `/runtime/session-context`, `/runtime/wallet-balances`, `/runtime/applications` | Authenticated | Owned |
| Register Cylinder | Customer | Cylinders | `/customer/cylinders/register` | `workspaces/customer/screens/cylinders/RegisterCylinderScreen.tsx` | `/lpg/config`, `/lpg/cylinders`, `/runtime/media/assets` | Authenticated | Missing |
| Cylinder Photo Upload | Customer | Cylinders | `/customer/cylinders/register/photo` | `workspaces/customer/screens/cylinders/CylinderPhotoUploadScreen.tsx` | `/runtime/media/upload-sessions`, `/runtime/media/assets` | Media owner | Missing |
| Apply As Driver | Customer | Account | `/customer/account/partner-routes/driver` | `features/applications/screens/DriverApplicationScreen.tsx` | `/runtime/application-types`, `/runtime/applications`, `/runtime/documents` | Eligible customer | Missing |
| Register Station | Customer | Account | `/customer/account/partner-routes/station` | `features/applications/screens/StationApplicationScreen.tsx` | `/runtime/application-types`, `/runtime/applications`, `/runtime/documents` | Eligible customer | Missing |
| Driver Approval Status | Driver | Account | `/driver/account/application` | `features/applications/screens/ApplicationStatusScreen.tsx` | `/runtime/applications` | Applicant | Missing |
| Driver Home | Driver | Home | `/driver/home` | `workspaces/driver/screens/home/DriverHomeScreen.tsx` | `/runtime/drivers`, `/runtime/vehicles`, `/lpg/jobs`, `/runtime/wallet-balances`, `/runtime/commission-executions` | `platform.driver.read` | Owned |
| Driver Availability | Driver | Home | `/driver/home/availability` | `workspaces/driver/screens/home/DriverAvailabilityScreen.tsx` | Driver availability API required, `/lpg/driver-locations` | Approved driver | Missing API |
| Available Jobs | Driver | Jobs | `/driver/jobs` | `workspaces/driver/screens/jobs/DriverJobsScreen.tsx` | `/lpg/jobs?queue=driver` | Approved driver capability | Owned |
| Driver Job Details | Driver | Jobs | `/driver/jobs/:jobId` | `workspaces/driver/screens/jobs/DriverJobDetailsScreen.tsx` | `/lpg/jobs`, `/lpg/orders/financial-summary` | Assigned or offered driver | Missing |
| Accept Job | Driver | Jobs | `/driver/jobs/:jobId` | `features/dispatch/components/AcceptAssignmentAction.tsx` | `/lpg/orders/accept-assignment` | Offered driver | Missing |
| Navigate To Customer | Driver | Jobs | `/driver/jobs/:jobId/customer-route` | `workspaces/driver/screens/jobs/CustomerPickupScreen.tsx` | `/lpg/maps/route-estimate`, `/lpg/driver-locations`, `/lpg/orders/actions` | Assigned driver | Missing |
| Customer Arrival | Driver | Jobs | `/driver/jobs/:jobId/customer-arrival` | `workspaces/driver/screens/jobs/CustomerPickupScreen.tsx` | `/lpg/orders/actions`, `/lpg/driver-locations` | Assigned driver | Missing |
| Pickup And Scan Cylinder | Driver | Scan | `/driver/jobs/:jobId/pickup` | `workspaces/driver/screens/scan/DriverScanScreen.tsx` | `/lpg/scans` | Assigned driver | Owned shell; action missing |
| Navigate To Station | Driver | Jobs | `/driver/jobs/:jobId/station-route` | `workspaces/driver/screens/jobs/StationRouteScreen.tsx` | `/lpg/maps/route-estimate`, `/lpg/driver-locations`, `/lpg/orders/actions` | Assigned driver | Missing |
| Station Handoff / Wait | Driver | Jobs | `/driver/jobs/:jobId/station-handoff` | `workspaces/driver/screens/jobs/StationRouteScreen.tsx` | `/lpg/orders/active`, `/lpg/scans`, `/lpg/inspections` | Assigned driver | Missing |
| Return To Customer | Driver | Jobs | `/driver/jobs/:jobId/return` | `workspaces/driver/screens/jobs/ReturnDeliveryScreen.tsx` | `/lpg/maps/route-estimate`, `/lpg/driver-locations`, `/lpg/orders/actions` | Assigned driver | Missing |
| Deliver And Verify | Driver | Jobs | `/driver/jobs/:jobId/delivery` | `workspaces/driver/screens/jobs/ReturnDeliveryScreen.tsx` | `/lpg/orders/delivery-challenge`, `/lpg/scans` | Assigned driver | Missing |
| Job Completed | Driver | Jobs | `/driver/jobs/:jobId/completed` | `features/orders/screens/DriverJobCompletedScreen.tsx` | `/lpg/orders`, `/lpg/orders/execute-driver-commission` | Assigned driver | Missing |
| Driver Earnings Breakdown | Driver | Earnings | `/driver/earnings/:orderId` | `workspaces/driver/screens/earnings/DriverEarningsScreen.tsx` | `/lpg/orders/financial-summary`, `/runtime/commission-executions` | Commission beneficiary | Missing detail |
| Driver Earnings History | Driver | Earnings | `/driver/earnings` | `workspaces/driver/screens/earnings/DriverEarningsScreen.tsx` | `/runtime/commission-executions`, `/runtime/wallet-balances` | Wallet owner | Owned |
| Driver Withdrawal | Driver | Earnings | `/driver/earnings/withdraw` | `workspaces/driver/screens/earnings/DriverWithdrawalScreen.tsx` | `/runtime/withdrawal-beneficiaries`, `/runtime/withdrawals` | Wallet owner | Missing |
| Driver Account | Driver | Account | `/driver/account` | `workspaces/driver/screens/account/DriverAccountScreen.tsx` | `/runtime/session-context`, `/runtime/drivers`, `/runtime/vehicles`, `/runtime/documents` | `platform.driver.read` | Owned |
| Driver Vehicle | Driver | Account | `/driver/account/vehicle` | `workspaces/driver/screens/account/DriverVehicleScreen.tsx` | `/runtime/vehicles`, `/runtime/media/assets` | Driver owner | Missing |
| Driver Documents | Driver | Account | `/driver/account/documents` | `workspaces/driver/screens/account/DriverDocumentsScreen.tsx` | `/runtime/documents`, `/runtime/media/assets` | Document owner | Missing |
| Driver Service Zone | Driver | Account | `/driver/account/service-zone` | `workspaces/driver/screens/account/DriverServiceZoneScreen.tsx` | Driver capability/zone API required | Approved driver | Missing API |
| Station Onboarding | Customer | Account | `/customer/account/partner-routes/station` | `features/applications/screens/StationApplicationScreen.tsx` | `/runtime/applications`, `/runtime/documents` | Eligible applicant | Missing |
| Station Dashboard | Station | Dashboard | `/station/dashboard` | `workspaces/station/screens/dashboard/StationDashboardScreen.tsx` | `/lpg/stations`, `/lpg/jobs?queue=station`, `/lpg/config` | `lpg.stations.read`, `lpg.orders.read` | Owned |
| Station Order Details | Station | Jobs | `/station/jobs/:jobId` | `workspaces/station/screens/jobs/StationJobDetailsScreen.tsx` | `/lpg/jobs`, `/lpg/orders/financial-summary` | `lpg.orders.read` | Missing |
| Driver Arriving | Station | Jobs | `/station/jobs/:jobId/driver-arrival` | `workspaces/station/screens/jobs/DriverArrivalScreen.tsx` | `/lpg/jobs`, `/lpg/driver-locations`, `/lpg/maps/route-estimate` | `lpg.orders.read` | Missing |
| Driver At Station | Station | Jobs | `/station/jobs/:jobId/driver-arrival` | `workspaces/station/screens/jobs/DriverArrivalScreen.tsx` | `/lpg/jobs`, `/lpg/scans` | `lpg.orders.read` | Missing |
| Cylinder Scan | Station | Scan | `/station/scan` | `workspaces/station/screens/scan/StationScanScreen.tsx` | `/lpg/scans`, `/lpg/cylinders` | `lpg.stations.scan` | Owned shell; action missing |
| Station Scan Result | Station | Scan | `/station/scan/result` | `workspaces/station/screens/scan/StationScanResultScreen.tsx` | `/lpg/scans`, `/lpg/cylinders`, `/lpg/inspections` | `lpg.stations.scan` | Missing |
| Cylinder Inspection | Station | Scan | `/station/scan/inspection` | `workspaces/station/screens/scan/CylinderInspectionScreen.tsx` | `/lpg/inspections`, `/runtime/media/assets` | `lpg.stations.scan` or `lpg.stations.pump` | Missing |
| Actual Kilograms | Station | Scan | `/station/scan/actual-kilograms` | `workspaces/station/screens/scan/ActualKilogramsScreen.tsx` | `/lpg/refills/confirm` | `lpg.stations.pump` | Missing |
| Refilling In Progress | Station | Jobs | `/station/jobs/:jobId/refill` | `workspaces/station/screens/jobs/RefillInProgressScreen.tsx` | `/lpg/orders/actions`, `/lpg/orders/active` | `lpg.stations.pump` | Missing |
| Refill Completed | Station | Jobs | `/station/jobs/:jobId/refill-complete` | `workspaces/station/screens/jobs/RefillCompletionScreen.tsx` | `/lpg/refills/confirm`, `/lpg/scans` | `lpg.stations.pump` | Missing |
| Station Order Delivered | Station | Jobs | `/station/jobs/:jobId/delivered` | `workspaces/station/screens/jobs/RefillCompletionScreen.tsx` | `/lpg/orders`, `/lpg/orders/settle-station` | `lpg.orders.read`; finance action separately gated | Missing |
| Station Earnings Breakdown | Station | Settlements | `/station/settlements/:orderId` | `workspaces/station/screens/settlements/StationSettlementsScreen.tsx` | `/lpg/orders/financial-summary`, `/runtime/settlement-statements` | `lpg.orders.finance` or `business.finance.read` | Missing detail |
| Station Wallet | Station | Settlements | `/station/settlements` | `workspaces/station/screens/settlements/StationSettlementsScreen.tsx` | `/runtime/wallet-balances`, `/runtime/settlement-statements` | `business.finance.read` or `business.settlements.read` | Owned |
| Station Transactions | Station | Settlements | `/station/settlements/transactions` | `workspaces/station/screens/settlements/StationTransactionsScreen.tsx` | `/runtime/settlement-statements`, `/runtime/withdrawals` | `business.finance.read` | Missing |
| Station Payouts | Station | Settlements | `/station/settlements/payouts` | `workspaces/station/screens/settlements/StationPayoutsScreen.tsx` | `/runtime/withdrawals`, `/runtime/withdrawals/transfers` | `business.settlements.read` | Missing |
| Station Withdrawal | Station | Settlements | `/station/settlements/withdraw` | `workspaces/station/screens/settlements/StationWithdrawalScreen.tsx` | `/runtime/withdrawal-beneficiaries`, `/runtime/withdrawals` | `business.finance.read` | Missing |
| Station Account | Station | Account | `/station/account` | `workspaces/station/screens/account/StationAccountScreen.tsx` | `/runtime/session-context`, `/lpg/stations` | `lpg.stations.read` | Missing; prototype incorrectly shows inventory |
| Station Inventory | Station | Account | `/station/account/inventory` | `workspaces/station/screens/account/StationInventoryScreen.tsx` | `/lpg/cylinders`, `/lpg/config`, `/runtime/media/assets` | `lpg.cylinders.read`; mutations require station management | Owned prototype to move |
| Station Staff And Roles | Station | Account | `/station/account/staff` | `workspaces/station/screens/account/StationStaffScreen.tsx` | `/runtime/organization-memberships`, `/runtime/organization-user-roles` | `business.staff.manage` | Missing |
| Station Roles And Permissions | Station | Account | `/station/account/roles` | `workspaces/station/screens/account/StationRolesScreen.tsx` | `/runtime/organization-roles`, `/lpg/config` | `business.staff.manage` | Missing |
| Station Settings | Station | Account | `/station/account/settings` | `workspaces/station/screens/account/StationSettingsScreen.tsx` | `/lpg/stations`, `/lpg/config` | `lpg.stations.manage` | Missing |
| Station Reports | Station | Account | `/station/account/reports` | `workspaces/station/screens/account/StationReportsScreen.tsx` | Reporting API required | `business.finance.read` | Missing API |
| Station More / Documents | Station | Account | `/station/account/documents` | `workspaces/station/screens/account/StationDocumentsScreen.tsx` | `/runtime/documents`, `/runtime/media/assets` | Station document access | Missing |

## Station Permission Map

| Station surface | Read permission | Action permission | Navigation behavior |
| --- | --- | --- | --- |
| Dashboard | `lpg.stations.read`, `lpg.orders.read` | none | Visible to approved station members with both permissions |
| Jobs | `lpg.orders.read` | `lpg.orders.manage` or `business.orders.process` | Read-only users see jobs without processing actions |
| Scan | `lpg.cylinders.read` | `lpg.stations.scan` | Hidden when scan permission is absent |
| Inspection | `lpg.cylinders.read` | `lpg.stations.scan` or `lpg.stations.pump` | Action gated independently |
| Refill | `lpg.orders.read` | `lpg.stations.pump` | Pump action hidden for scanner/viewer roles |
| Settlements | `business.settlements.read` | `business.finance.read` for withdrawal | Entire tab hidden when finance read permission is absent |
| Account | `lpg.stations.read` | capability-specific | Always available to approved station members |
| Profile and settings | `lpg.stations.read` | `lpg.stations.manage` | Management rows hidden from limited staff |
| Staff, roles, permissions | `lpg.stations.read` | `business.staff.manage` | Owner/admin only |
| Inventory | `lpg.cylinders.read` | station management permission for mutations | Read-only inventory remains possible |

## Missing Screens And Contracts

The inventory table is authoritative. The largest missing groups are customer order creation and
delivery verification, the complete driver job stack, station scan/refill detail screens, station
staff management, and nested transaction/withdrawal screens. Reviews, saved payment methods,
driver availability/service zones, and reports need dedicated backend contracts before production
implementation.

## Architecture Confirmations

- `apps/lpg-mobile` contains customer, driver, and station workspaces only.
- Skima company administration remains in `apps/admin` and is not routed from LPG mobile.
- Runtime cylinder, driver, vehicle, station, document, inspection, and application media comes
  from `/runtime/media/upload-sessions` and `/runtime/media/assets` records.
- Bundled or generated illustrations are limited to onboarding, empty, loading, safety, and other
  non-operational decoration.
- The authenticated root selects one backend-authorised workspace. Each workspace navigator owns
  its tab configuration and nested route registry.
- Each screen or feature hook loads only its own API dependencies.
