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

  it("restricts Fuel administration to platform Fuel readers", () => {
    expect(canAccessAdminNavigationKey("fuel", (permission) => permission === "platform.fuel.read")).toBe(true);
    expect(canAccessAdminNavigationKey("fuel", () => false)).toBe(false);
  });

  it("allows platform Fuel readers and managers to open Fuel administration", () => {
    expect(canAccessAdminNavigationKey("fuel", (permission) =>
      permission === "platform.fuel.read" || permission === "platform.fuel.manage"
    )).toBe(true);
    expect(canAccessAdminNavigationKey("fuel", (permission) => permission === "platform.fuel.read")).toBe(true);
    expect(canAccessAdminNavigationKey("fuel", () => false)).toBe(false);
  });

  it("still enforces simple focused-screen permissions", () => {
    expect(canAccessAdminNavigationKey("support", (permission) => permission === "platform.support.read")).toBe(true);
    expect(canAccessAdminNavigationKey("support", () => false)).toBe(false);
  });


  it("restricts the Store workspace to Store managers", () => {
    expect(canAccessAdminNavigationKey("store", (permission) => permission === "platform.store.manage")).toBe(true);
    expect(canAccessAdminNavigationKey("store", () => false)).toBe(false);
  });

  it("exposes financial analytics to platform finance readers", () => {
    expect(canAccessAdminNavigationKey("financial-analytics", (permission) => permission === "platform.financial.read")).toBe(true);
    expect(canAccessAdminNavigationKey("financial-analytics", () => false)).toBe(false);
  });

  it("limits social directory administration to authorized social managers", () => {
    expect(canAccessAdminNavigationKey("social-links", (permission) => permission === "platform.social.manage")).toBe(true);
    expect(canAccessAdminNavigationKey("social-links", () => false)).toBe(false);
  });

  it("limits shared referral campaign administration to content managers", () => {
    expect(canAccessAdminNavigationKey("referrals", (permission) => permission === "platform.content.manage")).toBe(true);
    expect(canAccessAdminNavigationKey("referrals", () => false)).toBe(false);
  });

  it("fails closed for unknown navigation keys", () => {
    expect(getAdminNavigationPermissionRule("unknown").known).toBe(false);
    expect(canAccessAdminNavigationKey("unknown", () => true)).toBe(false);
  });
});
