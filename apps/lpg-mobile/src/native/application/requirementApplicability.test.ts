import { requirementAppliesToPayload } from "./requirementApplicability";

describe("requirementAppliesToPayload", () => {
  it("keeps normal requirements applicable", () => {
    expect(requirementAppliesToPayload({ metadata: {} }, { authority: { role: "owner" } })).toBe(true);
  });

  it("does not require representative evidence from the station owner", () => {
    const requirement = {
      metadata: {
        required_when: {
          path: "authority.role",
          operator: "not_equals",
          value: "owner",
        },
      },
    };

    expect(requirementAppliesToPayload(requirement, { authority: { role: "owner" } })).toBe(false);
    expect(requirementAppliesToPayload(requirement, { authority: { role: "manager" } })).toBe(true);
  });

  it("supports in and existence conditions", () => {
    expect(
      requirementAppliesToPayload(
        {
          metadata: {
            required_when: {
              path: "authority.role",
              operator: "in",
              values: ["manager", "representative"],
            },
          },
        },
        { authority: { role: "representative" } },
      ),
    ).toBe(true);

    expect(
      requirementAppliesToPayload(
        {
          metadata: {
            required_when: {
              path: "station.latitude",
              operator: "exists",
            },
          },
        },
        { station: { latitude: 6.21 } },
      ),
    ).toBe(true);
  });
});
