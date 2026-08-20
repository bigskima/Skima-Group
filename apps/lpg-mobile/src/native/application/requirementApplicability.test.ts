import {
  applicationFieldIsComplete,
  requiredApplicationFields,
  requirementAppliesToPayload,
} from "./requirementApplicability";

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

describe("application field readiness", () => {
  const typeDefinition = {
    metadata: {
      submission_required_fields: [
        { path: "contact.phone", label: "Phone number", step: 1 },
        { path: "station.latitude", label: "Station GPS latitude", step: 2 },
      ],
    },
  };

  it("reads field rules from application type metadata", () => {
    expect(requiredApplicationFields(typeDefinition)).toEqual([
      { path: "contact.phone", label: "Phone number", stepIndex: 1 },
      { path: "station.latitude", label: "Station GPS latitude", stepIndex: 2 },
    ]);
  });

  it("treats blank strings and missing coordinates as incomplete", () => {
    const payload = { contact: { phone: "   " }, station: {} };
    expect(applicationFieldIsComplete(payload, "contact.phone")).toBe(false);
    expect(applicationFieldIsComplete(payload, "station.latitude")).toBe(false);
  });

  it("accepts populated text and numeric coordinates", () => {
    const payload = { contact: { phone: "07051118065" }, station: { latitude: 6.21 } };
    expect(applicationFieldIsComplete(payload, "contact.phone")).toBe(true);
    expect(applicationFieldIsComplete(payload, "station.latitude")).toBe(true);
  });
});
