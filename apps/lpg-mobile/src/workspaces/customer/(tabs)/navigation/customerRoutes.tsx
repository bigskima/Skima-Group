import type { SessionContext } from "@skima/frontend-core";
import type { ComponentType } from "react";

import type { NestedNavigator } from "@lpg/shared/types/navigation";
import { RoutePendingScreen } from "@lpg/shared/ui/RoutePendingScreen";
import { CustomerHomeScreen } from "../screens/home/CustomerHomeScreen";
import { CustomerCylindersScreen } from "../screens/cylinders/CustomerCylindersScreen";
import { CustomerOrdersScreen } from "../screens/orders/CustomerOrdersScreen";
import { CustomerOrderDetailsScreen } from "../screens/orders/CustomerOrderDetailsScreen";
import { CustomerWalletScreen } from "../screens/wallet/CustomerWalletScreen";
import { CustomerAccountScreen } from "../screens/account/CustomerAccountScreen";
import { PartnerRoutesScreen } from "../screens/account/PartnerRoutesScreen";
import { RegisterCylinderScreen } from "../screens/cylinders/RegisterCylinderScreen";
import { CylinderDetailsScreen } from "../screens/cylinders/CylinderDetailsScreen";
import { CreateRefillOrderScreen } from "../screens/orders/CreateRefillOrderScreen";
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
  "account-addresses": pendingCustomerScreen("Addresses"),
  "account-notifications": pendingCustomerScreen("Notifications"),
  "account-support": pendingCustomerScreen("Support"),
  "cylinder-details": CylinderDetailsScreen,
  "cylinder-photo": pendingCustomerScreen("Cylinder Photo"),
  "cylinder-register": RegisterCylinderScreen,
  cylinders: CustomerCylindersScreen,
  "delivery-verification": pendingCustomerScreen("Delivery Verification"),
  "driver-application": pendingCustomerScreen("Driver Application"),
  home: CustomerHomeScreen,
  "order-details": CustomerOrderDetailsScreen,
  "order-new": CreateRefillOrderScreen,
  "order-tracking": pendingCustomerScreen("Live Tracking"),
  orders: CustomerOrdersScreen,
  "partner-routes": PartnerRoutesScreen,
  "payment-methods": pendingCustomerScreen("Payment Methods"),
  "station-application": pendingCustomerScreen("Station Application"),
  wallet: CustomerWalletScreen,
  "wallet-top-up": pendingCustomerScreen("Top Up"),
  "wallet-transactions": pendingCustomerScreen("Transactions"),
};

function pendingCustomerScreen(title: string): ComponentType<CustomerScreenProps> {
  return function PendingCustomerScreen(props: CustomerScreenProps) {
    return <RoutePendingScreen title={title} onBack={props.navigation.goBack} />;
  };
}
