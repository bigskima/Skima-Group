import { describe, expect, it } from "vitest";

import type { NavigationItem } from "@skima/frontend-core";
import {
  buildAdminCategoryNavigation,
  getAdminWorkspaceForRoute,
  getAdminWorkspaceNavigation,
  resolveAdminPath,
  toAdminV2NavigationItem,
  toLegacyAdminWorkspacePath,
} from "./admin-v2-navigation";

describe("SKIMA Admin V2 navigation", () => {
  it("converts legacy flat routes into real category routes", () => {
    expect(resolveAdminPath("/applications")).toBe("/partners/applications");
    expect(resolveAdminPath("/revenue")).toBe("/money/revenue");
    expect(resolveAdminPath("/stations/demo-station")).toBe("/partners/stations/demo-station");
  });

  it("bridges V2 routes back to the current domain workspace during migration", () => {
    expect(toLegacyAdminWorkspacePath("/partners/applications")).toBe("/applications");
    expect(toLegacyAdminWorkspacePath("/money/pricing/delivery")).toBe("/delivery-pricing");
    expect(toLegacyAdminWorkspacePath("/partners/stations/demo-station")).toBe("/stations/demo-station");
  });

  it("builds one global navigation item per visible category", () => {
    const items: NavigationItem[] = [
      { key: "overview", label: "Overview", href: "/", icon: "overview" },
      { key: "applications", label: "Applications", href: "/applications", icon: "applications" },
      { key: "revenue", label: "Revenue", href: "/revenue", icon: "revenue" },
      { key: "finance", label: "Balances", href: "/finance", icon: "finance" },
    ].map(toAdminV2NavigationItem);

    const categories = buildAdminCategoryNavigation(items);
    expect(categories.map((item) => item.key)).toEqual([
      "dashboard",
      "partners",
      "money",
    ]);
    expect(categories.find((item) => item.key === "money")?.href).toBe("/money");
  });

  it("keeps the Money category root as a real landing screen", () => {
    expect(resolveAdminPath("/money")).toBe("/money");
  });

  it("splits Money into focused permission-aware screens", () => {
    const items: NavigationItem[] = [
      { key: "revenue", label: "Money & Revenue", href: "/revenue", icon: "revenue" },
      { key: "finance", label: "Wallets & Settlements", href: "/finance", icon: "finance" },
      { key: "delivery-pricing", label: "Delivery Pricing", href: "/delivery-pricing", icon: "deliveryPricing" },
      { key: "driver-pricing", label: "Driver Pricing", href: "/driver-pricing", icon: "driverPricing" },
    ].map(toAdminV2NavigationItem);

    expect(getAdminWorkspaceNavigation("money", items).map((item) => item.href)).toEqual([
      "/money",
      "/money/revenue",
      "/money/balances",
      "/money/withdrawals",
      "/money/settlements",
      "/money/pricing",
      "/money/controls",
    ]);
  });

  it("resolves the active workspace from nested URLs", () => {
    expect(getAdminWorkspaceForRoute("/partners/stations/123").key).toBe("partners");
    expect(getAdminWorkspaceForRoute("/money/pricing/drivers").key).toBe("money");
  });
});
