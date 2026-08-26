import { LpgServiceabilitySchema } from "./serviceability";

describe("LpgServiceabilitySchema", () => {
  it("accepts the universal coordinate-policy response on web, Android, and iOS", () => {
    expect(LpgServiceabilitySchema.parse({
      serviceable: false,
      status: "unavailable",
      reason: "SERVICE_NOT_LAUNCHED",
      matchedArea: null,
      partnerOpportunity: true,
      partnerOpportunities: { driver: true, station: false },
    })).toMatchObject({ reason: "SERVICE_NOT_LAUNCHED" });
  });

  it("accepts a matched universal policy without requiring a city label", () => {
    const result = LpgServiceabilitySchema.parse({
      serviceable: true,
      status: "available",
      reason: "AVAILABLE",
      matchedArea: {
        id: "11111111-1111-4111-8111-111111111111",
        policyId: "22222222-2222-4222-8222-222222222222",
      },
      partnerOpportunity: false,
      partnerOpportunities: { driver: false, station: false },
    });
    expect(result.serviceable).toBe(true);
  });
});
