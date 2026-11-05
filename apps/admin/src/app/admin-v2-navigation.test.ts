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
    expect(resolveAdminPath("/utility-billing")).toBe("/services/utility-billing");
    expect(resolveAdminPath("/ai")).toBe("/intelligence/ask");
    expect(resolveAdminPath("/content")).toBe("/experience/content");
    expect(resolveAdminPath("/policies")).toBe("/experience/policies");
    expect(resolveAdminPath("/branding")).toBe("/experience/branding");
    expect(resolveAdminPath("/access")).toBe("/platform/people-access");
    expect(resolveAdminPath("/governance")).toBe("/platform/configuration");
    expect(resolveAdminPath("/providers")).toBe("/platform/integrations");
    expect(resolveAdminPath("/system")).toBe("/platform/system");
  });

  it("bridges V2 routes back to the current domain workspace during migration", () => {
    expect(toLegacyAdminWorkspacePath("/partners/applications")).toBe("/applications");
    expect(toLegacyAdminWorkspacePath("/money/pricing/delivery")).toBe("/delivery-pricing");
    expect(toLegacyAdminWorkspacePath("/partners/stations/demo-station")).toBe("/stations/demo-station");
    expect(toLegacyAdminWorkspacePath("/operations/orders")).toBe("/operations");
    expect(toLegacyAdminWorkspacePath("/operations/coverage")).toBe("/coverage");
    expect(toLegacyAdminWorkspacePath("/services/utility-billing")).toBe("/utility-billing");
    expect(toLegacyAdminWorkspacePath("/services/catalog")).toBe("/catalog");
    expect(toLegacyAdminWorkspacePath("/intelligence/ask")).toBe("/ai");
    expect(toLegacyAdminWorkspacePath("/experience/content")).toBe("/content");
    expect(toLegacyAdminWorkspacePath("/experience/policies")).toBe("/policies");
    expect(toLegacyAdminWorkspacePath("/experience/branding")).toBe("/branding");
    expect(toLegacyAdminWorkspacePath("/platform/people-access")).toBe("/access");
    expect(toLegacyAdminWorkspacePath("/platform/configuration")).toBe("/governance");
    expect(toLegacyAdminWorkspacePath("/platform/integrations")).toBe("/providers");
    expect(toLegacyAdminWorkspacePath("/platform/system")).toBe("/system");
  });

  it("builds one global navigation item per visible category", () => {
    const items: NavigationItem[] = [
      { key: "overview", label: "Overview", href: "/", icon: "overview" },
      { key: "applications", label: "Applications", href: "/applications", icon: "applications" },
      { key: "operations", label: "Operations", href: "/operations", icon: "operations" },
      { key: "revenue", label: "Revenue", href: "/revenue", icon: "revenue" },
      { key: "finance", label: "Balances", href: "/finance", icon: "finance" },
      { key: "billing", label: "Utility Billing", href: "/utility-billing", icon: "billing" },
      { key: "catalog", label: "Services", href: "/catalog", icon: "catalog" },
      { key: "refill", label: "Refill", href: "/refill", icon: "refill" },
      { key: "bills", label: "Bills", href: "/bills", icon: "bills" },
      { key: "store", label: "Store", href: "/store", icon: "store" },
      { key: "logistics", label: "Logistics", href: "/logistics", icon: "logistics" },
      { key: "ai", label: "SKIMA Intelligence", href: "/ai", icon: "ai" },
      { key: "content", label: "Brand & Content", href: "/content", icon: "content" },
      { key: "policies", label: "Terms & Policies", href: "/policies", icon: "policies" },
      { key: "branding", label: "App Branding", href: "/branding", icon: "branding" },
      { key: "access", label: "People & Access", href: "/access", icon: "access" },
      { key: "governance", label: "Configuration", href: "/governance", icon: "governance" },
      { key: "providers", label: "Integrations", href: "/providers", icon: "providers" },
      { key: "system", label: "System", href: "/system", icon: "system" },
    ].map(toAdminV2NavigationItem);

    const categories = buildAdminCategoryNavigation(items);
    expect(categories.map((item) => item.key)).toEqual([
      "dashboard",
      "partners",
      "operations",
      "money",
      "services",
      "refill",
      "bills",
      "store",
      "logistics",
      "intelligence",
      "experience",
      "platform",
    ]);
    expect(categories.find((item) => item.key === "partners")?.href).toBe("/partners");
    expect(categories.find((item) => item.key === "operations")?.href).toBe("/operations");
    expect(categories.find((item) => item.key === "money")?.href).toBe("/money");
    expect(categories.find((item) => item.key === "services")?.href).toBe("/services");
    expect(categories.find((item) => item.key === "refill")?.href).toBe("/refill");
    expect(categories.find((item) => item.key === "bills")?.href).toBe("/bills");
    expect(categories.find((item) => item.key === "store")?.href).toBe("/store");
    expect(categories.find((item) => item.key === "intelligence")?.href).toBe("/intelligence");
    expect(categories.find((item) => item.key === "experience")?.href).toBe("/experience");
    expect(categories.find((item) => item.key === "platform")?.href).toBe("/platform");
  });

  it("exposes Logistics as a dedicated permission-gated workspace with operational sections", () => {
    const items: NavigationItem[] = [
      { key: "logistics", label: "Logistics", href: "/logistics", icon: "logistics" },
    ].map(toAdminV2NavigationItem);

    expect(getAdminWorkspaceForRoute("/logistics/disputes").key).toBe("logistics");
    expect(getAdminWorkspaceNavigation("logistics", items).map((item) => item.href)).toEqual([
      "/logistics",
      "/logistics/providers",
      "/logistics/bookings",
      "/logistics/incidents",
      "/logistics/disputes",
      "/logistics/categories",
    ]);
  });

  it("keeps migrated category roots as real landing screens", () => {
    expect(resolveAdminPath("/partners")).toBe("/partners");
    expect(resolveAdminPath("/operations")).toBe("/operations");
    expect(resolveAdminPath("/money")).toBe("/money");
    expect(resolveAdminPath("/services")).toBe("/services");
    expect(resolveAdminPath("/store")).toBe("/store");
    expect(resolveAdminPath("/logistics")).toBe("/logistics");
    expect(resolveAdminPath("/intelligence")).toBe("/intelligence");
    expect(resolveAdminPath("/experience")).toBe("/experience");
    expect(resolveAdminPath("/platform")).toBe("/platform");
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

  it("builds focused Operations navigation from existing permissions", () => {
    const items: NavigationItem[] = [
      { key: "operations", label: "Operations", href: "/operations", icon: "operations" },
      { key: "coverage", label: "Coverage", href: "/coverage", icon: "coverage" },
      { key: "inventory", label: "Inventory", href: "/station-inventory", icon: "inventory" },
      { key: "quality", label: "Quality", href: "/quality", icon: "quality" },
      { key: "support", label: "Support", href: "/support", icon: "support" },
    ].map(toAdminV2NavigationItem);

    expect(getAdminWorkspaceNavigation("operations", items).map((item) => item.href)).toEqual([
      "/operations",
      "/operations/orders",
      "/operations/coverage",
      "/operations/inventory",
      "/operations/quality",
      "/operations/support",
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
      "/money/analytics",
      "/money/balances",
      "/money/withdrawals",
      "/money/settlements",
      "/money/pricing",
      "/money/controls",
    ]);
  });

  it("splits Services into utility billing, catalog and availability screens", () => {
    const items: NavigationItem[] = [
      { key: "billing", label: "Utility Billing", href: "/utility-billing", icon: "billing" },
      { key: "catalog", label: "Services", href: "/catalog", icon: "catalog" },
    ].map(toAdminV2NavigationItem);

    expect(getAdminWorkspaceNavigation("services", items).map((item) => item.href)).toEqual([
      "/services",
      "/services/utility-billing",
      "/services/catalog",
      "/services/availability",
    ]);
  });


  it("groups existing LPG and fuel controls in a dedicated Refill workspace", () => {
    const items: NavigationItem[] = [
      { key: "refill", label: "Refill", href: "/refill", icon: "refill" },
      { key: "operations", label: "Operations", href: "/operations", icon: "operations" },
      { key: "stations", label: "Stations", href: "/stations", icon: "stations" },
      { key: "inventory", label: "Inventory", href: "/station-inventory", icon: "inventory" },
      { key: "coverage", label: "Coverage", href: "/coverage", icon: "coverage" },
      { key: "fuel", label: "Fuel", href: "/services/fuel", icon: "fuel" },
      { key: "delivery-pricing", label: "Delivery pricing", href: "/delivery-pricing", icon: "deliveryPricing" },
    ].map(toAdminV2NavigationItem);

    expect(getAdminWorkspaceForRoute("/refill/stations").key).toBe("refill");
    expect(getAdminWorkspaceNavigation("refill", items).map((item) => item.href)).toEqual([
      "/refill",
      "/refill/orders",
      "/refill/stations",
      "/refill/inventory",
      "/refill/coverage",
      "/refill/fuel",
      "/refill/fulfillment",
    ]);
  });

  it("gives Bills its own provider, catalogue, routing and operations navigation", () => {
    const items: NavigationItem[] = [
      { key: "bills", label: "Bills", href: "/bills", icon: "bills" },
      { key: "billing", label: "Utility billing", href: "/utility-billing", icon: "billing" },
    ].map(toAdminV2NavigationItem);

    expect(getAdminWorkspaceForRoute("/bills/providers").key).toBe("bills");
    expect(getAdminWorkspaceNavigation("bills", items).map((item) => item.href)).toEqual([
      "/bills",
      "/bills/providers",
      "/bills/catalogue",
      "/bills/routing",
      "/bills/economics",
      "/bills/campaigns",
      "/bills/operations",
      "/bills/live-test",
    ]);
    expect(getAdminWorkspaceNavigation("services", items)).toEqual([]);
  });

  it("keeps Store in its own focused admin workspace", () => {
    const items: NavigationItem[] = [
      { key: "store", label: "Store", href: "/store", icon: "store" },
    ].map(toAdminV2NavigationItem);

    expect(getAdminWorkspaceForRoute("/store").key).toBe("store");
    expect(getAdminWorkspaceNavigation("store", items).map((item) => item.href)).toEqual([
      "/store",
    ]);
  });

  it("gives SKIMA Intelligence a category landing without duplicating its governed workspace", () => {
    const items: NavigationItem[] = [
      { key: "ai", label: "SKIMA Intelligence", href: "/ai", icon: "ai" },
    ].map(toAdminV2NavigationItem);

    expect(getAdminWorkspaceNavigation("intelligence", items).map((item) => item.href)).toEqual([
      "/intelligence",
      "/intelligence/ask",
    ]);
  });

  it("splits Experience into content, policies and app branding", () => {
    const items: NavigationItem[] = [
      { key: "content", label: "Brand & Content", href: "/content", icon: "content" },
      { key: "policies", label: "Terms & Policies", href: "/policies", icon: "policies" },
      { key: "branding", label: "App Branding", href: "/branding", icon: "branding" },
    ].map(toAdminV2NavigationItem);

    expect(getAdminWorkspaceNavigation("experience", items).map((item) => item.href)).toEqual([
      "/experience",
      "/experience/content",
      "/experience/policies",
      "/experience/branding",
    ]);
  });

  it("splits Platform into access, configuration, integrations and system health", () => {
    const items: NavigationItem[] = [
      { key: "access", label: "People & Access", href: "/access", icon: "access" },
      { key: "governance", label: "Configuration", href: "/governance", icon: "governance" },
      { key: "providers", label: "Integrations", href: "/providers", icon: "providers" },
      { key: "system", label: "System", href: "/system", icon: "system" },
    ].map(toAdminV2NavigationItem);

    expect(getAdminWorkspaceNavigation("platform", items).map((item) => item.href)).toEqual([
      "/platform",
      "/platform/people-access",
      "/platform/configuration",
      "/platform/integrations",
      "/platform/system",
    ]);
  });

  it("resolves the active workspace from nested URLs", () => {
    expect(getAdminWorkspaceForRoute("/partners/stations/123").key).toBe("partners");
    expect(getAdminWorkspaceForRoute("/operations/coverage").key).toBe("operations");
    expect(getAdminWorkspaceForRoute("/money/pricing/drivers").key).toBe("money");
    expect(getAdminWorkspaceForRoute("/services/availability").key).toBe("services");
    expect(getAdminWorkspaceForRoute("/intelligence/ask").key).toBe("intelligence");
    expect(getAdminWorkspaceForRoute("/experience/branding").key).toBe("experience");
    expect(getAdminWorkspaceForRoute("/platform/integrations").key).toBe("platform");
  });
});
