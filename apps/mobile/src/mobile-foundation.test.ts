import { describe, expect, it } from "vitest";

import {
  businessModuleVisualIdentities,
  filterMobileNavigation,
  mobileAssetRequirements,
  mobileCurrencyPreferencePolicy,
  mobileFoundationSurfaces,
  mobileInterfaceThemeOptions,
  validateBusinessModuleVisualIdentity,
  validateMobileSurface,
} from "@skima/mobile-design";

import { phaseOneLpgExperience, resolvePhaseOneRoleExperience } from "./phase-one-lpg";

describe("mobile foundation contract", () => {
  it("defines customer, driver, partner, and admin-ready surfaces", () => {
    const surfaceKeys = new Set(mobileFoundationSurfaces.map((surface) => surface.key));

    expect(surfaceKeys.has("home")).toBe(true);
    expect(surfaceKeys.has("tasks")).toBe(true);
    expect(surfaceKeys.has("fleet")).toBe(true);
    expect(surfaceKeys.has("business")).toBe(true);
    expect(surfaceKeys.has("catalog")).toBe(true);

    for (const surface of mobileFoundationSurfaces) {
      expect(() => validateMobileSurface(surface)).not.toThrow();
    }
  });

  it("filters mobile navigation by permission without changing the source catalog", () => {
    const driverNavigation = filterMobileNavigation(
      [
        {
          key: "home",
          label: "Home",
          surfaceKey: "home",
          audience: "customer",
        },
        {
          key: "tasks",
          label: "Tasks",
          surfaceKey: "tasks",
          audience: "driver",
          requiredPermissions: ["platform.driver.read"],
        },
      ],
      { permissions: ["platform.driver.read"] },
    );

    expect(driverNavigation.map((item) => item.key)).toEqual(["home", "tasks"]);
  });

  it("keeps module visual identities data-driven instead of source-code service catalogs", () => {
    expect(businessModuleVisualIdentities).toEqual([]);

    for (const identity of businessModuleVisualIdentities) {
      expect(() => validateBusinessModuleVisualIdentity(identity)).not.toThrow();
    }
  });

  it("defines reusable interface themes and backend-driven currency preferences", () => {
    expect(mobileInterfaceThemeOptions.map((option) => option.value)).toEqual([
      "system",
      "light",
      "dark",
    ]);
    expect(mobileCurrencyPreferencePolicy.source).toBe("currency_definitions");
    expect(mobileCurrencyPreferencePolicy.enabledStatus).toBe("active");
  });

  it("keeps the LPG launch experience isolated from shared primitives", () => {
    expect(phaseOneLpgExperience.identity.label).toBe("LPG Refill");
    expect(resolvePhaseOneRoleExperience("customer").nav.map((item) => item.label)).toEqual([
      "Home",
      "Cylinders",
      "Orders",
      "Wallet",
      "Account",
    ]);
    expect(resolvePhaseOneRoleExperience("driver").nav.map((item) => item.label)).toContain(
      "Verify",
    );
    expect(resolvePhaseOneRoleExperience("partner").nav.map((item) => item.label)).toContain(
      "Refills",
    );
  });

  it("requires media roles for logos, covers, documents, QR, maps, and vehicles", () => {
    const roles = new Set(mobileAssetRequirements.map((asset) => asset.role));

    expect(roles.has("business_logo")).toBe(true);
    expect(roles.has("business_cover")).toBe(true);
    expect(roles.has("catalog_image")).toBe(true);
    expect(roles.has("vehicle_image")).toBe(true);
    expect(roles.has("driver_avatar")).toBe(true);
    expect(roles.has("document_preview")).toBe(true);
    expect(roles.has("qr_payload")).toBe(true);
    expect(roles.has("map_preview")).toBe(true);
  });
});
