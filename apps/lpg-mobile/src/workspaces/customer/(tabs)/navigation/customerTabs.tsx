import { ClipboardList, Home, QrCode, User, WalletCards } from "lucide-react";

import type { WorkspaceTab } from "@lpg/shared/types/navigation";

export type CustomerTab = "home" | "cylinders" | "orders" | "wallet" | "account";

export const customerTabs: readonly WorkspaceTab<CustomerTab>[] = [
  { icon: <Home aria-hidden="true" />, key: "home", label: "Home" },
  { icon: <QrCode aria-hidden="true" />, key: "cylinders", label: "Cylinders" },
  { icon: <ClipboardList aria-hidden="true" />, key: "orders", label: "Orders" },
  { icon: <WalletCards aria-hidden="true" />, key: "wallet", label: "Wallet" },
  { icon: <User aria-hidden="true" />, key: "account", label: "Account" },
] as const;
