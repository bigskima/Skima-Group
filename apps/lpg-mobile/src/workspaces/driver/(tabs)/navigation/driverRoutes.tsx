import type { SessionContext } from "@skima/frontend-core";
import type { ComponentType } from "react";

import type { NestedNavigator } from "@lpg/shared/types/navigation";
import { RoutePendingScreen } from "@lpg/shared/ui/RoutePendingScreen";
import { DriverHomeScreen } from "../screens/home/DriverHomeScreen";
import { DriverJobsScreen } from "../screens/jobs/DriverJobsScreen";
import { DriverJobDetailsScreen } from "../screens/jobs/DriverJobDetailsScreen";
import { DriverScanScreen } from "../screens/scan/DriverScanScreen";
import { DriverEarningsScreen } from "../screens/earnings/DriverEarningsScreen";
import { DriverAccountScreen } from "../screens/account/DriverAccountScreen";
import type { DriverTab } from "./driverTabs";

export type DriverRoute =
  | "home"
  | "availability"
  | "jobs"
  | "job-details"
  | "customer-route"
  | "customer-arrival"
  | "pickup-verification"
  | "station-route"
  | "station-handoff"
  | "return-route"
  | "delivery-verification"
  | "job-completed"
  | "scan"
  | "scan-result"
  | "earnings"
  | "earnings-transactions"
  | "earnings-withdrawal"
  | "account"
  | "profile"
  | "vehicle"
  | "documents"
  | "service-zone";

export interface DriverScreenProps {
  readonly context: SessionContext;
  readonly navigation: NestedNavigator<DriverRoute>;
}

export const driverTabRoots: Readonly<Record<DriverTab, DriverRoute>> = {
  account: "account",
  earnings: "earnings",
  home: "home",
  jobs: "jobs",
  scan: "scan",
};

export const driverRouteTabs: Readonly<Record<DriverRoute, DriverTab>> = {
  account: "account",
  availability: "home",
  "customer-arrival": "jobs",
  "customer-route": "jobs",
  "delivery-verification": "jobs",
  documents: "account",
  earnings: "earnings",
  "earnings-transactions": "earnings",
  "earnings-withdrawal": "earnings",
  home: "home",
  "job-completed": "jobs",
  "job-details": "jobs",
  jobs: "jobs",
  "pickup-verification": "jobs",
  profile: "account",
  "return-route": "jobs",
  scan: "scan",
  "scan-result": "scan",
  "service-zone": "account",
  "station-handoff": "jobs",
  "station-route": "jobs",
  vehicle: "account",
};

export const driverRouteScreens: Readonly<Record<DriverRoute, ComponentType<DriverScreenProps>>> = {
  account: DriverAccountScreen,
  availability: pendingDriverScreen("Availability"),
  "customer-arrival": pendingDriverScreen("Customer Arrival"),
  "customer-route": pendingDriverScreen("Route To Customer"),
  "delivery-verification": pendingDriverScreen("Delivery Verification"),
  documents: pendingDriverScreen("Driver Documents"),
  earnings: DriverEarningsScreen,
  "earnings-transactions": pendingDriverScreen("Earnings Transactions"),
  "earnings-withdrawal": pendingDriverScreen("Withdraw Earnings"),
  home: DriverHomeScreen,
  "job-completed": pendingDriverScreen("Job Completed"),
  "job-details": DriverJobDetailsScreen,
  jobs: DriverJobsScreen,
  "pickup-verification": pendingDriverScreen("Pickup Verification"),
  profile: pendingDriverScreen("Driver Profile"),
  "return-route": pendingDriverScreen("Return Delivery"),
  scan: DriverScanScreen,
  "scan-result": pendingDriverScreen("Scan Result"),
  "service-zone": pendingDriverScreen("Service Zone"),
  "station-handoff": pendingDriverScreen("Station Handoff"),
  "station-route": pendingDriverScreen("Route To Station"),
  vehicle: pendingDriverScreen("Driver Vehicle"),
};

function pendingDriverScreen(title: string): ComponentType<DriverScreenProps> {
  return function PendingDriverScreen(props: DriverScreenProps) {
    return <RoutePendingScreen title={title} onBack={props.navigation.goBack} />;
  };
}
