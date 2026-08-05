import type { SessionContext } from "@skima/frontend-core";
import type { ComponentType } from "react";

import type { NestedNavigator } from "@lpg/shared/types/navigation";
import { DriverHomeScreen } from "../screens/home/DriverHomeScreen";
import { AvailabilityScreen } from "../screens/home/AvailabilityScreen";
import { DriverJobsScreen } from "../screens/jobs/DriverJobsScreen";
import { DriverJobDetailsScreen } from "../screens/jobs/DriverJobDetailsScreen";
import { DriverScanScreen } from "../screens/scan/DriverScanScreen";
import { DriverEarningsScreen } from "../screens/earnings/DriverEarningsScreen";
import { DriverAccountScreen } from "../screens/account/DriverAccountScreen";
import { DriverDocumentsScreen, DriverProfileScreen, DriverServiceZoneScreen, DriverVehicleScreen } from "../screens/account/DriverAccountDetailScreens";
import { DriverEarningsTransactionsScreen, DriverWithdrawalScreen } from "../screens/earnings/DriverEarningsDetailScreens";
import { CustomerArrivalScreen, CustomerRouteScreen, DriverDeliveryVerificationScreen, JobCompletedScreen, PickupVerificationScreen, ReturnRouteScreen, ScanResultScreen, StationHandoffScreen, StationRouteScreen } from "../screens/jobs/DriverWorkflowScreens";
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
  availability: AvailabilityScreen,
  "customer-arrival": CustomerArrivalScreen,
  "customer-route": CustomerRouteScreen,
  "delivery-verification": DriverDeliveryVerificationScreen,
  documents: DriverDocumentsScreen,
  earnings: DriverEarningsScreen,
  "earnings-transactions": DriverEarningsTransactionsScreen,
  "earnings-withdrawal": DriverWithdrawalScreen,
  home: DriverHomeScreen,
  "job-completed": JobCompletedScreen,
  "job-details": DriverJobDetailsScreen,
  jobs: DriverJobsScreen,
  "pickup-verification": PickupVerificationScreen,
  profile: DriverProfileScreen,
  "return-route": ReturnRouteScreen,
  scan: DriverScanScreen,
  "scan-result": ScanResultScreen,
  "service-zone": DriverServiceZoneScreen,
  "station-handoff": StationHandoffScreen,
  "station-route": StationRouteScreen,
  vehicle: DriverVehicleScreen,
};
