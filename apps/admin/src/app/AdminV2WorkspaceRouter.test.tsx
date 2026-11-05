import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../features/store/StoreWorkspace", () => ({
  StoreWorkspace: () => "store-workspace-mounted",
}));

vi.mock("../features/logistics/LogisticsWorkspace", () => ({
  LogisticsWorkspace: ({ route }: { route: string }) => "logistics-workspace-mounted:" + route,
}));

vi.mock("../features/refill/RefillWorkspaceRouter", () => ({
  RefillWorkspaceRouter: ({ route }: { route: string }) => "refill-workspace-mounted:" + route,
}));

vi.mock("../features/services/UtilityBillingWorkspaceV2", () => ({
  UtilityBillingWorkspaceV2: ({ route, basePath }: { route: string; basePath: string }) => "bills-workspace-mounted:" + basePath + ":" + route,
}));

vi.mock("../admin-workspace-router", () => ({
  AdminWorkspaceRouter: () => "legacy-overview-fallback",
}));

import { AdminV2WorkspaceRouter } from "./AdminV2WorkspaceRouter";

describe("AdminV2WorkspaceRouter", () => {
  it("opens the integrated Logistics workspace for its landing and nested admin routes", () => {
    for (const route of ["/logistics", "/logistics/providers", "/logistics/bookings", "/logistics/incidents", "/logistics/disputes", "/logistics/categories"]) {
      const markup = renderToStaticMarkup(
        createElement(AdminV2WorkspaceRouter, {
          route,
          onNavigate: () => undefined,
        }),
      );
      expect(markup).toContain("logistics-workspace-mounted:" + route);
      expect(markup).not.toContain("legacy-overview-fallback");
    }
  });

  it("opens the dedicated Refill workspace without falling through to the legacy router", () => {
    const markup = renderToStaticMarkup(
      createElement(AdminV2WorkspaceRouter, {
        route: "/refill/orders",
        onNavigate: () => undefined,
      }),
    );

    expect(markup).toContain("refill-workspace-mounted:/refill/orders");
    expect(markup).not.toContain("legacy-overview-fallback");
  });

  it("opens the existing utility billing runtime inside the dedicated Bills route base", () => {
    for (const route of ["/bills", "/bills/providers", "/bills/catalogue", "/bills/operations"]) {
      const markup = renderToStaticMarkup(
        createElement(AdminV2WorkspaceRouter, {
          route,
          onNavigate: () => undefined,
        }),
      );

      expect(markup).toContain("bills-workspace-mounted:/bills:" + route);
      expect(markup).not.toContain("legacy-overview-fallback");
    }
  });

  it("opens the dedicated Store workspace instead of the legacy overview fallback", () => {
    const markup = renderToStaticMarkup(
      createElement(AdminV2WorkspaceRouter, {
        route: "/store",
        onNavigate: () => undefined,
      }),
    );

    expect(markup).toContain("store-workspace-mounted");
    expect(markup).not.toContain("legacy-overview-fallback");
  });
});
