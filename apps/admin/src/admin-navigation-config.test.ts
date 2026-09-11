import { describe, expect, it } from "vitest";

import {
  canAccessAdminNavigationKey,
  getAdminNavigationPermissionRule,
} from "./admin-navigation-config";

describe("admin navigation access rules", () => {
  it("keeps the dashboard available to authenticated administrators", () => {
    expect(canAccessAdminNavigationKey("overview", () => false)).toBe(true);
  });

  it("accepts alternate operational permissions where the screen supports them", () => {
    expect(canAccessAdminNavigationKey("verification", (permission) => permission === "platform.verification.manage")).toBe(true);
    expect(canAccessAdminNavigationKey("operations", (permission) => permission === "lpg.dispatch.execute")).toBe(true);
    expect(canAccessAdminNavigationKey("coverage", (permission) => permission === "platform.coverage.manage")).toBe(true);
    expect(canAccessAdminNavigationKey("drivers", (permission) => permission === "platform.drivers.verify")).toBe(true);
    expect(canAccessAdminNavigationKey("quality", (permission) => permission === "lpg.quality.manage")).toBe(true);
  });

  it("accepts governed financial-policy roles without requiring read specifically", () => {
    expect(canAccessAdminNavigationKey("delivery-pricing", (permission) => permission === "platform.financial_policy.approve")).toBe(true);
    expect(canAccessAdminNavigationKey("driver-pricing", (permission) => permission === "platform.financial_policy.activate")).toBe(true);
  });

  it("still enforces simple focused-screen permissions", () => {
    expect(canAccessAdminNavigationKey("support", (permission) => permission === "platform.support.read")).toBe(true);
    expect(canAccessAdminNavigationKey("support", () => false)).toBe(false);
  });

  it("fails closed for unknown navigation keys", () => {
    expect(getAdminNavigationPermissionRule("unknown").known).toBe(false);
    expect(canAccessAdminNavigationKey("unknown", () => true)).toBe(false);
  });
});
