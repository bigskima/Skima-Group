import { describe, expect, it } from "vitest";

import {
  getInitialTab,
  isWorkspaceTab,
  resolveAvailableWorkspaces,
  resolveEffectiveCurrencies,
  workspaceConfigs,
} from "./features/permissions/workspaceAccess";
import { customerTabs } from "./workspaces/customer/(tabs)/navigation/customerTabs";
import { customerRouteTabs } from "./workspaces/customer/(tabs)/navigation/customerRoutes";
import { driverTabs } from "./workspaces/driver/(tabs)/navigation/driverTabs";
import { driverRouteTabs } from "./workspaces/driver/(tabs)/navigation/driverRoutes";
import { buildStationTabs } from "./workspaces/station/(tabs)/navigation/stationTabs";
import { stationRouteTabs } from "./workspaces/station/(tabs)/navigation/stationRoutes";

describe("LPG mobile product contract", () => {
  it("uses the LPG launch navigation for all primary workspaces", () => {
    expect(workspaceConfigs.customer.nav.map((item) => item.label)).toEqual([
      "Home",
      "Cylinders",
      "Orders",
      "Wallet",
      "Account",
    ]);
    expect(workspaceConfigs.driver.nav.map((item) => item.label)).toEqual([
      "Home",
      "Jobs",
      "Scan",
      "Earnings",
      "Account",
    ]);
    expect(workspaceConfigs.station.nav.map((item) => item.label)).toEqual([
      "Dashboard",
      "Jobs",
      "Scan",
      "Settlements",
      "Account",
    ]);
  });

  it("opens each approved experience with its own five-tab contract", () => {
    expect(customerTabs.map((item) => item.label)).toEqual([
      "Home", "Cylinders", "Orders", "Wallet", "Account",
    ]);
    expect(driverTabs.map((item) => item.label)).toEqual([
      "Home", "Jobs", "Scan", "Earnings", "Account",
    ]);
    expect(customerRouteTabs["order-tracking"]).toBe("orders");
    expect(driverRouteTabs["pickup-verification"]).toBe("jobs");
    expect(stationRouteTabs["actual-kilograms"]).toBe("scan");
  });

  it("builds station tabs from backend permissions", () => {
    const owner = sessionContext([
      "lpg.stations.manage",
      "lpg.orders.manage",
      "lpg.orders.read",
      "lpg.stations.scan",
      "lpg.orders.finance",
    ]);
    const pump = sessionContext([
      "lpg.orders.read",
      "lpg.stations.pump",
    ]);

    expect(buildStationTabs(owner).map((item) => item.label)).toEqual([
      "Dashboard", "Jobs", "Scan", "Settlements", "Account",
    ]);
    expect(buildStationTabs(pump).map((item) => item.label)).toEqual([
      "Jobs", "Scan", "Account",
    ]);
  });

  it("unlocks driver and station only when the backend manifest confirms them", () => {
    const context = sessionContext([]);
    const workspaces = resolveAvailableWorkspaces(context, {
      workspaces: [
        {
          branchIds: [],
          capabilityKeys: [],
          key: "customer",
          organizationIds: [],
          status: "active",
          subjectId: context.user.id,
          subjectType: "profile",
        },
        {
          branchIds: [],
          capabilityKeys: ["lpg.delivery"],
          key: "driver",
          organizationIds: [],
          status: "active",
          subjectId: "00000000-0000-4000-8000-000000000002",
          subjectType: "driver_profile",
          vehicleIds: ["00000000-0000-4000-8000-000000000003"],
        },
      ],
    });

    expect(workspaces).toEqual(["customer", "driver"]);
  });

  it("guards workspace tabs by workspace", () => {
    expect(getInitialTab("station")).toBe("dashboard");
    expect(isWorkspaceTab("customer", "cylinders")).toBe(true);
    expect(isWorkspaceTab("customer", "settlements")).toBe(false);
  });

  it("keeps customer as the default and does not expose company admin in mobile", () => {
    const workspaces = resolveAvailableWorkspaces({
      organizations: [],
      permissions: [],
      platformAdmin: null,
      profile: null,
      roles: [],
      user: { email: "customer@example.com", id: "00000000-0000-4000-8000-000000000001" },
    });

    expect(workspaces).toEqual(["customer"]);
    expect(Object.keys(workspaceConfigs)).toEqual(["customer", "driver", "station"]);
  });

  it("resolves global, user-hidden, and profile-restricted currencies", () => {
    const result = resolveEffectiveCurrencies({
      currencyRecords: [
        { code: "NGN", decimal_places: 2, display_name: "Nigerian Naira", status: "active" },
        { code: "USD", decimal_places: 2, display_name: "US Dollar", status: "active" },
        { code: "USDC", decimal_places: 6, display_name: "USD Coin", status: "active" },
      ],
      profileMetadata: {
        disabledCurrencyCodes: ["USDC"],
      },
      userHiddenCodes: ["USD"],
    });

    expect(result.globallyEnabledCurrencies.map((currency) => currency.code)).toEqual([
      "NGN",
      "USD",
      "USDC",
    ]);
    expect(result.effectiveCurrencies.map((currency) => currency.code)).toEqual(["NGN"]);
    expect(
      result.globallyEnabledCurrencies.find((currency) => currency.code === "USDC")
        ?.lockedForProfile,
    ).toBe(true);
    expect(
      result.globallyEnabledCurrencies.find((currency) => currency.code === "USD")?.hiddenByUser,
    ).toBe(true);
  });
});

function sessionContext(permissions: readonly string[]) {
  return {
    organizations: [],
    permissions,
    platformAdmin: null,
    profile: null,
    roles: [],
    user: { email: "customer@example.com", id: "00000000-0000-4000-8000-000000000001" },
  } as const;
}
