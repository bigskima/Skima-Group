import type { SessionContext } from "@skima/frontend-core";
import { ClipboardList, Home, QrCode, User, WalletCards } from "lucide-react";

import { canReadStationFinance, hasAnyPermission } from "@lpg/shared/api/records";
import type { WorkspaceTab } from "@lpg/shared/types/navigation";

export type StationTab = "dashboard" | "jobs" | "scan" | "settlements" | "account";

export function buildStationTabs(context: SessionContext): readonly WorkspaceTab<StationTab>[] {
  const tabs: WorkspaceTab<StationTab>[] = [];

  if (hasAnyPermission(context, ["lpg.stations.manage", "lpg.orders.manage", "business.orders.manage"])) {
    tabs.push({ icon: <Home aria-hidden="true" />, key: "dashboard", label: "Dashboard" });
  }

  if (hasAnyPermission(context, ["lpg.orders.read", "business.orders.read", "business.orders.process"])) {
    tabs.push({ icon: <ClipboardList aria-hidden="true" />, key: "jobs", label: "Jobs" });
  }

  if (hasAnyPermission(context, ["lpg.stations.scan", "lpg.stations.pump"])) {
    tabs.push({ center: true, icon: <QrCode aria-hidden="true" />, key: "scan", label: "Scan" });
  }

  if (canReadStationFinance(context)) {
    tabs.push({ icon: <WalletCards aria-hidden="true" />, key: "settlements", label: "Settlements" });
  }

  tabs.push({ icon: <User aria-hidden="true" />, key: "account", label: "Account" });
  return tabs;
}
