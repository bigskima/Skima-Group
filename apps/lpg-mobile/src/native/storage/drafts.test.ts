import AsyncStorage from "@react-native-async-storage/async-storage";
import { draftStore } from "./drafts";

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

describe("workflow draft persistence", () => {
  beforeEach(async () => AsyncStorage.clear());

  it("isolates drafts by authenticated owner", async () => {
    const now = new Date().toISOString();
    await draftStore.save({
      version: 1,
      type: "customer-refill-request",
      ownerProfileId: "profile-one",
      step: "location",
      values: { requestedKg: "12" },
      pendingMedia: [],
      createdAt: now,
      updatedAt: now,
    });
    expect(
      await draftStore.load("profile-two", "customer-refill-request"),
    ).toBeNull();
    expect(
      (await draftStore.load("profile-one", "customer-refill-request"))?.values
        .requestedKg,
    ).toBe("12");
  });

  it("preserves creation time across autosaves", async () => {
    const createdAt = "2026-08-10T00:00:00.000Z";
    await draftStore.save({
      version: 1,
      type: "driver-vehicle-registration",
      ownerProfileId: "driver-one",
      step: "details",
      values: {},
      pendingMedia: [],
      createdAt,
      updatedAt: createdAt,
    });
    await draftStore.save({
      version: 1,
      type: "driver-vehicle-registration",
      ownerProfileId: "driver-one",
      step: "documents",
      values: {},
      pendingMedia: [],
      createdAt: "2026-08-10T01:00:00.000Z",
      updatedAt: "2026-08-10T01:00:00.000Z",
    });
    const restored = await draftStore.load(
      "driver-one",
      "driver-vehicle-registration",
    );
    expect(restored?.createdAt).toBe(createdAt);
    expect(restored?.step).toBe("documents");
  });

  it("invalidates corrupt or incompatible drafts safely", async () => {
    await AsyncStorage.setItem(
      "skima:draft:v1:customer-one:customer-cylinder-registration",
      "not-json",
    );
    await expect(
      draftStore.load("customer-one", "customer-cylinder-registration"),
    ).resolves.toBeNull();
  });
});
