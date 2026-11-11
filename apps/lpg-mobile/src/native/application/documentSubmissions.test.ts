import {
  documentSubmissionIsReady,
  driverDocumentStepIndex,
  latestDocumentSubmissionForRequirement,
  stationDocumentStepIndex,
} from "./documentSubmissions";

describe("driver application document readiness", () => {
  const requirement = {
    id: "identity-requirement-id",
    key: "driver.identity",
  };

  it("counts a newer successful upload instead of an older rejected upload", () => {
    const submissions = [
      {
        id: "older-rejected",
        requirement_id: requirement.id,
        status: "rejected",
        created_at: "2026-11-10T08:00:00.000Z",
        updated_at: "2026-11-10T10:00:00.000Z",
      },
      {
        id: "newer-upload",
        requirement_id: requirement.id,
        status: "uploaded",
        created_at: "2026-11-10T09:00:00.000Z",
      },
    ];

    const latest = latestDocumentSubmissionForRequirement(
      submissions,
      requirement.key,
      requirement,
    );

    expect(latest?.id).toBe("newer-upload");
    expect(documentSubmissionIsReady(latest)).toBe(true);
  });

  it("keeps a newest rejected replacement request incomplete", () => {
    const submissions = [
      {
        id: "older-approved",
        requirement_id: requirement.id,
        status: "approved",
        created_at: "2026-11-10T08:00:00.000Z",
      },
      {
        id: "newer-rejected",
        requirement_id: requirement.id,
        status: "rejected",
        replacement_requested: true,
        created_at: "2026-11-10T09:00:00.000Z",
      },
    ];

    const latest = latestDocumentSubmissionForRequirement(
      submissions,
      requirement.key,
      requirement,
    );

    expect(latest?.id).toBe("newer-rejected");
    expect(documentSubmissionIsReady(latest)).toBe(false);
  });

  it("matches the backend requirement key contract as well as requirement IDs", () => {
    const latest = latestDocumentSubmissionForRequirement(
      [
        {
          id: "key-matched",
          requirement_key: "driver.identity",
          status: "submitted",
          submitted_at: "2026-11-10T09:00:00.000Z",
        },
      ],
      requirement.key,
      requirement,
    );

    expect(latest?.id).toBe("key-matched");
    expect(documentSubmissionIsReady(latest)).toBe(true);
  });

  it.each(["uploaded", "submitted", "under_review", "approved"])(
    "accepts %s as a saved document",
    (status) => {
      expect(documentSubmissionIsReady({ status })).toBe(true);
    },
  );

  it.each(["draft", "rejected", "correction_required", "expired", "withdrawn", "quarantined"])(
    "does not count %s as a ready document",
    (status) => {
      expect(documentSubmissionIsReady({ status })).toBe(false);
    },
  );

  it("does not count a file while a replacement is requested", () => {
    expect(
      documentSubmissionIsReady({
        status: "uploaded",
        replacement_requested: true,
      }),
    ).toBe(false);
  });
});


describe("driver document review navigation", () => {
  it("opens identity and driver photo in the identity step", () => {
    expect(driverDocumentStepIndex("driver.identity")).toBe(2);
    expect(driverDocumentStepIndex("driver.profile-photo")).toBe(2);
  });

  it("opens a driver licence in the licence step", () => {
    expect(driverDocumentStepIndex("driver.licence")).toBe(3);
  });
});


describe("station document review navigation", () => {
  it("opens owner and representative identity evidence in the representative step", () => {
    expect(stationDocumentStepIndex("station.owner-identity")).toBe(1);
    expect(stationDocumentStepIndex("station.representative-identity")).toBe(1);
    expect(stationDocumentStepIndex("station.representative-photo")).toBe(1);
  });

  it("opens business registration evidence with the business details", () => {
    expect(stationDocumentStepIndex("station.business-registration")).toBe(2);
  });

  it("keeps authority, permits and safety certificates in compliance", () => {
    expect(stationDocumentStepIndex("station.authority-evidence")).toBe(3);
    expect(stationDocumentStepIndex("station.business-permit")).toBe(3);
    expect(stationDocumentStepIndex("station.fire-safety-certificate")).toBe(3);
    expect(stationDocumentStepIndex("station.regulatory-certificate")).toBe(3);
  });

  it("opens all structured station photographs in the premises-photo step", () => {
    expect(stationDocumentStepIndex("station.photo.front")).toBe(4);
    expect(stationDocumentStepIndex("station.photo.tank")).toBe(4);
  });
});
