import { ClipboardList, Home, QrCode, User, WalletCards } from "lucide-react";

import type { WorkspaceTab } from "@lpg/shared/types/navigation";

export type DriverTab = "home" | "jobs" | "scan" | "earnings" | "account";

export const driverTabs: readonly WorkspaceTab<DriverTab>[] = [
  { icon: <Home aria-hidden="true" />, key: "home", label: "Home" },
  { icon: <ClipboardList aria-hidden="true" />, key: "jobs", label: "Jobs" },
  { center: true, icon: <QrCode aria-hidden="true" />, key: "scan", label: "Scan" },
  { icon: <WalletCards aria-hidden="true" />, key: "earnings", label: "Earnings" },
  { icon: <User aria-hidden="true" />, key: "account", label: "Account" },
] as const;
