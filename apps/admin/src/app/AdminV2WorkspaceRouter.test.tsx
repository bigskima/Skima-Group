import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../features/store/StoreWorkspace", () => ({
  StoreWorkspace: () => "store-workspace-mounted",
}));

vi.mock("../features/logistics/LogisticsWorkspace", () => ({
  LogisticsWorkspace: ({ route }: { route: string }) => "logistics-workspace-mounted:" + route,
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
