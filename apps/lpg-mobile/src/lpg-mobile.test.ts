import { describe, expect, it } from "vitest";

import {
  getInitialTab,
  isWorkspaceTab,
  resolveEffectiveCurrencies,
  workspaceConfigs,
} from "./lpg-experience";

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

  it("guards workspace tabs by workspace", () => {
    expect(getInitialTab("station")).toBe("dashboard");
    expect(isWorkspaceTab("customer", "cylinders")).toBe(true);
    expect(isWorkspaceTab("customer", "settlements")).toBe(false);
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
