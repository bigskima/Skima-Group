import type { SessionContext } from "@skima/frontend-core";
import type { ComponentType } from "react";

import type { NestedNavigator } from "@lpg/shared/types/navigation";
import { RoutePendingScreen } from "@lpg/shared/ui/RoutePendingScreen";
import { StationDashboardScreen } from "../screens/dashboard/StationDashboardScreen";
import { StationJobsScreen } from "../screens/jobs/StationJobsScreen";
import { StationJobDetailsScreen } from "../screens/jobs/StationJobDetailsScreen";
import { StationScanScreen } from "../screens/scan/StationScanScreen";
import { StationSettlementsScreen } from "../screens/settlements/StationSettlementsScreen";
import { StationAccountScreen } from "../screens/account/StationAccountScreen";
import type { StationTab } from "./stationTabs";

export type StationRoute =
  | "dashboard"
  | "jobs"
  | "job-details"
  | "driver-arrival"
  | "refill-in-progress"
  | "refill-completion"
  | "order-delivered"
  | "scan"
  | "scan-result"
  | "inspection"
  | "actual-kilograms"
  | "settlements"
  | "settlement-details"
  | "settlement-transactions"
  | "settlement-payouts"
  | "settlement-withdrawal"
  | "account"
  | "station-profile"
  | "inventory"
  | "staff"
  | "roles"
  | "permissions"
  | "station-settings"
  | "station-reports"
  | "station-documents";

export interface StationScreenProps {
  readonly context: SessionContext;
  readonly navigation: NestedNavigator<StationRoute>;
}

export const stationTabRoots: Readonly<Record<StationTab, StationRoute>> = {
  account: "account",
  dashboard: "dashboard",
  jobs: "jobs",
  scan: "scan",
  settlements: "settlements",
};

export const stationRouteTabs: Readonly<Record<StationRoute, StationTab>> = {
  account: "account",
  "actual-kilograms": "scan",
  dashboard: "dashboard",
  "driver-arrival": "jobs",
  inspection: "scan",
  inventory: "account",
  "job-details": "jobs",
  jobs: "jobs",
  "order-delivered": "jobs",
  permissions: "account",
  "refill-completion": "jobs",
  "refill-in-progress": "jobs",
  roles: "account",
  scan: "scan",
  "scan-result": "scan",
  "settlement-details": "settlements",
  "settlement-payouts": "settlements",
  "settlement-transactions": "settlements",
  "settlement-withdrawal": "settlements",
  settlements: "settlements",
  staff: "account",
  "station-documents": "account",
  "station-profile": "account",
  "station-reports": "account",
  "station-settings": "account",
};

export const stationRouteScreens: Readonly<Record<StationRoute, ComponentType<StationScreenProps>>> = {
  account: StationAccountScreen,
  "actual-kilograms": pendingStationScreen("Actual Kilograms"),
  dashboard: StationDashboardScreen,
  "driver-arrival": pendingStationScreen("Driver Arrival"),
  inspection: pendingStationScreen("Cylinder Inspection"),
  inventory: pendingStationScreen("Inventory"),
  "job-details": StationJobDetailsScreen,
  jobs: StationJobsScreen,
  "order-delivered": pendingStationScreen("Order Delivered"),
  permissions: pendingStationScreen("Station Permissions"),
  "refill-completion": pendingStationScreen("Refill Completion"),
  "refill-in-progress": pendingStationScreen("Refill In Progress"),
  roles: pendingStationScreen("Station Roles"),
  scan: StationScanScreen,
  "scan-result": pendingStationScreen("Scan Result"),
  "settlement-details": pendingStationScreen("Settlement Details"),
  "settlement-payouts": pendingStationScreen("Payouts"),
  "settlement-transactions": pendingStationScreen("Transactions"),
  "settlement-withdrawal": pendingStationScreen("Withdraw"),
  settlements: StationSettlementsScreen,
  staff: pendingStationScreen("Staff"),
  "station-documents": pendingStationScreen("Station Documents"),
  "station-profile": pendingStationScreen("Station Profile"),
  "station-reports": pendingStationScreen("Reports"),
  "station-settings": pendingStationScreen("Station Settings"),
};

function pendingStationScreen(title: string): ComponentType<StationScreenProps> {
  return function PendingStationScreen(props: StationScreenProps) {
    return <RoutePendingScreen title={title} onBack={props.navigation.goBack} />;
  };
}
