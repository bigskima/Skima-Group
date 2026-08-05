import type { SessionContext } from "@skima/frontend-core";
import type { ComponentType } from "react";

import type { NestedNavigator } from "@lpg/shared/types/navigation";
import { AddressesScreen } from "../screens/account/AddressesScreen";
import { CustomerHomeScreen } from "../screens/home/CustomerHomeScreen";
import { CustomerCylindersScreen } from "../screens/cylinders/CustomerCylindersScreen";
import { CustomerOrdersScreen } from "../screens/orders/CustomerOrdersScreen";
import { CustomerOrderDetailsScreen } from "../screens/orders/CustomerOrderDetailsScreen";
import { CustomerWalletScreen } from "../screens/wallet/CustomerWalletScreen";
import { CustomerAccountScreen } from "../screens/account/CustomerAccountScreen";
import { DriverApplicationScreen } from "../screens/account/DriverApplicationScreen";
import { NotificationsScreen } from "../screens/account/NotificationsScreen";
import { PartnerRoutesScreen } from "../screens/account/PartnerRoutesScreen";
import { StationApplicationScreen } from "../screens/account/StationApplicationScreen";
import { SupportScreen } from "../screens/account/SupportScreen";
import { RegisterCylinderScreen } from "../screens/cylinders/RegisterCylinderScreen";
import { CylinderDetailsScreen } from "../screens/cylinders/CylinderDetailsScreen";
import { CylinderPhotoUploadScreen } from "../screens/cylinders/CylinderPhotoUploadScreen";
import { CustomerLiveTrackingScreen } from "../screens/orders/CustomerLiveTrackingScreen";
import { DeliveryVerificationScreen } from "../screens/orders/DeliveryVerificationScreen";
import { NewRefillScreen } from "../screens/orders/NewRefillScreen";
import { PaymentMethodsScreen } from "../screens/wallet/PaymentMethodsScreen";
import { TopUpScreen } from "../screens/wallet/TopUpScreen";
import { TransactionsScreen } from "../screens/wallet/TransactionsScreen";
import type { CustomerTab } from "./customerTabs";

export type CustomerRoute =
  | "home"
  | "cylinders"
  | "cylinder-details"
  | "cylinder-register"
  | "cylinder-photo"
  | "orders"
  | "order-new"
  | "order-details"
  | "order-tracking"
  | "delivery-verification"
  | "wallet"
  | "wallet-top-up"
  | "wallet-transactions"
  | "payment-methods"
  | "account"
  | "account-addresses"
  | "account-notifications"
  | "account-support"
  | "partner-routes"
  | "driver-application"
  | "station-application";

export interface CustomerScreenProps {
  readonly context: SessionContext;
  readonly navigation: NestedNavigator<CustomerRoute>;
}

export const customerTabRoots: Readonly<Record<CustomerTab, CustomerRoute>> = {
  account: "account",
  cylinders: "cylinders",
  home: "home",
  orders: "orders",
  wallet: "wallet",
};

export const customerRouteTabs: Readonly<Record<CustomerRoute, CustomerTab>> = {
  account: "account",
  "account-addresses": "account",
  "account-notifications": "account",
  "account-support": "account",
  "cylinder-details": "cylinders",
  "cylinder-photo": "cylinders",
  "cylinder-register": "cylinders",
  cylinders: "cylinders",
  "delivery-verification": "orders",
  "driver-application": "account",
  home: "home",
  "order-details": "orders",
  "order-new": "orders",
  "order-tracking": "orders",
  orders: "orders",
  "partner-routes": "account",
  "payment-methods": "wallet",
  "station-application": "account",
  wallet: "wallet",
  "wallet-top-up": "wallet",
  "wallet-transactions": "wallet",
};

export const customerRouteScreens: Readonly<Record<CustomerRoute, ComponentType<CustomerScreenProps>>> = {
  account: CustomerAccountScreen,
  "account-addresses": AddressesScreen,
  "account-notifications": NotificationsScreen,
  "account-support": SupportScreen,
  "cylinder-details": CylinderDetailsScreen,
  "cylinder-photo": CylinderPhotoUploadScreen,
  "cylinder-register": RegisterCylinderScreen,
  cylinders: CustomerCylindersScreen,
  "delivery-verification": DeliveryVerificationScreen,
  "driver-application": DriverApplicationScreen,
  home: CustomerHomeScreen,
  "order-details": CustomerOrderDetailsScreen,
  "order-new": NewRefillScreen,
  "order-tracking": CustomerLiveTrackingScreen,
  orders: CustomerOrdersScreen,
  "partner-routes": PartnerRoutesScreen,
  "payment-methods": PaymentMethodsScreen,
  "station-application": StationApplicationScreen,
  wallet: CustomerWalletScreen,
  "wallet-top-up": TopUpScreen,
  "wallet-transactions": TransactionsScreen,
};
