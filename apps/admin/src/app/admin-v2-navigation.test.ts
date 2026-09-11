import { describe, expect, it } from "vitest";

import type { NavigationItem } from "@skima/frontend-core";
import {
  buildAdminCategoryNavigation,
  getAdminWorkspaceForRoute,
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

    expect(buildAdminCategoryNavigation(items).map((item) => item.key)).toEqual([
      "dashboard",
      "partners",
      "money",
    ]);
  });

  it("resolves the active workspace from nested URLs", () => {
    expect(getAdminWorkspaceForRoute("/partners/stations/123").key).toBe("partners");
    expect(getAdminWorkspaceForRoute("/money/pricing/drivers").key).toBe("money");
  });
});
