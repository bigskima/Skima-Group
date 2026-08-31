import { describe, expect, it } from "vitest";
import { stationIdFromPricingRoute } from "./admin-station-pricing-workspace";

describe("Admin station pricing route", () => {
  it("retains the selected station in a valid price route", () => {
    expect(stationIdFromPricingRoute("/stations/8efb01f1-3aed-4474-9dd2-eb2057f1a80f/pricing"))
      .toBe("8efb01f1-3aed-4474-9dd2-eb2057f1a80f");
  });

  it("rejects missing and malformed station context", () => {
    expect(stationIdFromPricingRoute("/stations/pricing")).toBeNull();
    expect(stationIdFromPricingRoute("/stations/not-an-id/pricing")).toBeNull();
  });
});
