import { describe, expect, it } from "vitest";

import { shouldShowWorkspaceRouteUnavailable } from "./admin-route-recovery";

describe("admin workspace route recovery", () => {
  it("shows a recovery state for an unavailable child inside a visible workspace", () => {
    expect(shouldShowWorkspaceRouteUnavailable({
      route: "/operations/not-a-screen",
      workspaceBasePath: "/operations",
      workspaceVisible: true,
      hasVisibleScreen: false,
    })).toBe(true);
  });

  it("keeps authorized screens on their normal route", () => {
    expect(shouldShowWorkspaceRouteUnavailable({
      route: "/operations/orders/SK-1042",
      workspaceBasePath: "/operations",
      workspaceVisible: true,
      hasVisibleScreen: true,
    })).toBe(false);
  });

  it("fails closed when the workspace itself is not visible", () => {
    expect(shouldShowWorkspaceRouteUnavailable({
      route: "/money/settlements",
      workspaceBasePath: "/money",
      workspaceVisible: false,
      hasVisibleScreen: false,
    })).toBe(false);
  });

  it("does not treat unrelated global paths as workspace recovery routes", () => {
    expect(shouldShowWorkspaceRouteUnavailable({
      route: "/does-not-exist",
      workspaceBasePath: "/dashboard",
      workspaceVisible: true,
      hasVisibleScreen: false,
    })).toBe(false);
  });
});
