import { describe, expect, it } from "vitest";

import {
  createApiGatewayClient,
  createClientIdempotencyKey,
  filterNavigationItems,
  formatMoney,
  hasPermission,
  type OnboardingFlowDefinition,
  resolveOnboardingFlow,
} from "@skima/frontend-core";
import { z } from "zod";

import {
  catalogConsoleConfig,
  financeConsoleConfig,
  governanceConsoleConfig,
  integrationConsoleConfig,
  operationsConsoleConfig,
  organizationConsoleConfig,
} from "./admin-resource-config";

describe("frontend foundation contracts", () => {
  it("requires every requested permission before granting access", () => {
    expect(hasPermission({ permissions: ["platform.financial.read"] }, "platform.financial.read"))
      .toBe(true);
    expect(
      hasPermission(
        { permissions: ["platform.financial.read"] },
        ["platform.financial.read", "platform.financial.manage"],
      ),
    ).toBe(false);
  });

  it("filters navigation from backend-driven permissions", () => {
    const items = filterNavigationItems(
      [
        { key: "overview", label: "Overview", href: "/" },
        {
          key: "finance",
          label: "Finance",
          href: "/finance",
          requiredPermissions: ["platform.financial.read"],
        },
      ],
      { permissions: ["platform.financial.read"] },
    );

    expect(items.map((item) => item.key)).toEqual(["overview", "finance"]);
  });

  it("locks onboarding steps until dependencies and permissions are satisfied", () => {
    const flow: OnboardingFlowDefinition = {
      key: "operator",
      title: "Operator",
      audience: "platform",
      steps: [
        { key: "session", title: "Session", description: "Authenticated session." },
        {
          key: "finance",
          title: "Finance",
          description: "Financial workspace.",
          dependsOn: ["session"],
          requiredPermissions: ["platform.financial.read"],
        },
      ],
    };

    const steps = resolveOnboardingFlow(flow, ["session"], { permissions: [] });

    expect(steps[0].status).toBe("complete");
    expect(steps[1].status).toBe("locked");
  });

  it("formats money from minor units without assuming a business module", () => {
    expect(formatMoney(125000, "NGN")).toContain("1,250.00");
  });

  it("creates unique operation keys for retried frontend mutations", () => {
    const firstKey = createClientIdempotencyKey("Application Review", "record-1");
    const secondKey = createClientIdempotencyKey("Application Review", "record-1");

    expect(firstKey).toMatch(/^frontend:application-review:record-1:/);
    expect(firstKey).not.toEqual(secondKey);
  });

  it("covers critical admin action surfaces without duplicate action keys", () => {
    const configs = [
      governanceConsoleConfig,
      organizationConsoleConfig,
      catalogConsoleConfig,
      operationsConsoleConfig,
      financeConsoleConfig,
      integrationConsoleConfig,
    ];
    const actions = configs.flatMap((config) =>
      config.groups.flatMap((group) => group.actions.map((action) => action.key))
    );

    expect(new Set(actions).size).toBe(actions.length);
    expect(actions).toContain("approve-withdrawal");
    expect(actions).toContain("release-escrow");
    expect(actions).toContain("set-staff-status");
    expect(actions).toContain("set-profile-status");
    expect(actions).toContain("configure-admin-user");
    expect(actions).toContain("configure-item");
    expect(actions).toContain("record-verification");
  });

  it("binds browser fetch when the gateway client uses the default fetcher", async () => {
    const originalFetch = globalThis.fetch;
    let fetchThis: unknown = null;

    globalThis.fetch = async function boundFetchSmoke(this: unknown) {
      fetchThis = this;

      return new Response(JSON.stringify({ ok: true, data: { value: "ok" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    } as typeof fetch;

    try {
      const api = createApiGatewayClient({
        apiGatewayUrl: "https://example.test/functions/v1/api-gateway",
        anonKey: "anon-key",
        getAccessToken: async () => "access-token",
      });

      await expect(api.get("/runtime/session-context", z.object({ value: z.literal("ok") })))
        .resolves
        .toEqual({ value: "ok" });
      expect(fetchThis).toBe(globalThis);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
