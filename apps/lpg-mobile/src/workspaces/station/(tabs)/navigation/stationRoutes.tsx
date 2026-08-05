import type { SessionContext } from "@skima/frontend-core";
import type { ComponentType } from "react";

import type { NestedNavigator } from "@lpg/shared/types/navigation";
import {
  StationDocumentsScreen,
  StationInventoryScreen,
  StationPermissionsScreen,
  StationProfileScreen,
  StationReportsScreen,
  StationRolesScreen,
  StationSettingsScreen,
  StationStaffScreen,
} from "../screens/account/StationAccountDetailScreens";
import { StationDashboardScreen } from "../screens/dashboard/StationDashboardScreen";
import { StationJobsScreen } from "../screens/jobs/StationJobsScreen";
import { StationJobDetailsScreen } from "../screens/jobs/StationJobDetailsScreen";
import {
  StationActualKilogramsScreen,
  StationDriverArrivalScreen,
  StationInspectionScreen,
  StationOrderReleasedScreen,
  StationRefillCompletionScreen,
  StationRefillInProgressScreen,
  StationScanResultScreen,
} from "../screens/jobs/StationWorkflowScreens";
import { StationScanScreen } from "../screens/scan/StationScanScreen";
import {
  StationSettlementDetailsScreen,
  StationSettlementPayoutsScreen,
  StationSettlementTransactionsScreen,
  StationSettlementWithdrawalScreen,
} from "../screens/settlements/StationSettlementDetailScreens";
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
  "actual-kilograms": StationActualKilogramsScreen,
  dashboard: StationDashboardScreen,
  "driver-arrival": StationDriverArrivalScreen,
  inspection: StationInspectionScreen,
  inventory: StationInventoryScreen,
  "job-details": StationJobDetailsScreen,
  jobs: StationJobsScreen,
  "order-delivered": StationOrderReleasedScreen,
  permissions: StationPermissionsScreen,
  "refill-completion": StationRefillCompletionScreen,
  "refill-in-progress": StationRefillInProgressScreen,
  roles: StationRolesScreen,
  scan: StationScanScreen,
  "scan-result": StationScanResultScreen,
  "settlement-details": StationSettlementDetailsScreen,
  "settlement-payouts": StationSettlementPayoutsScreen,
  "settlement-transactions": StationSettlementTransactionsScreen,
  "settlement-withdrawal": StationSettlementWithdrawalScreen,
  settlements: StationSettlementsScreen,
  staff: StationStaffScreen,
  "station-documents": StationDocumentsScreen,
  "station-profile": StationProfileScreen,
  "station-reports": StationReportsScreen,
  "station-settings": StationSettingsScreen,
};
