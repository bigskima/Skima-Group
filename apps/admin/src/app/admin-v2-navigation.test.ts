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
    expect(categories.find((item) => item.key === "partners")?.href).toBe("/partners");
    expect(categories.find((item) => item.key === "money")?.href).toBe("/money");
  });

  it("keeps migrated category roots as real landing screens", () => {
    expect(resolveAdminPath("/partners")).toBe("/partners");
    expect(resolveAdminPath("/money")).toBe("/money");
  });

  it("builds focused People and Partners navigation from existing permissions", () => {
    const items: NavigationItem[] = [
      { key: "applications", label: "Applications", href: "/applications", icon: "applications" },
      { key: "company", label: "Companies", href: "/company", icon: "company" },
      { key: "drivers", label: "Driver Participation", href: "/drivers", icon: "drivers" },
      { key: "stations", label: "Stations", href: "/stations", icon: "stations" },
      { key: "verification", label: "Verification", href: "/verification", icon: "verification" },
      { key: "fleet", label: "Fleet", href: "/fleet", icon: "fleet" },
    ].map(toAdminV2NavigationItem);

    expect(getAdminWorkspaceNavigation("partners", items).map((item) => item.href)).toEqual([
      "/partners",
      "/partners/applications",
      "/partners/companies",
      "/partners/drivers",
      "/partners/stations",
      "/partners/verification",
      "/partners/fleet",
    ]);
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
