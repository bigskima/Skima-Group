import type { OperationalLocation } from "../device/location";
import { prepareLocationSave, reuseLocationSaveAttempt } from "./locationSave";

const selected: OperationalLocation = {
  latitude: 6.524379,
  longitude: 3.379206,
  accuracyMeters: 12,
  recordedAt: "2026-09-05T00:00:00.000Z",
  formattedAddress: "12 Marina Road, Lagos",
  providerPlaceId: "place-1",
  providerSource: "maps_adapter",
  address: {
    name: null,
    street: "Marina Road",
    district: "Lagos Island",
    city: "Lagos",
    region: "Lagos",
    postalCode: null,
    country: "Nigeria",
    countryCode: "ng",
    neighbourhood: "Marina",
    town: null,
    village: null,
    lga: "Lagos Island",
    state: "Lagos",
    stateCode: "LA",
  },
};

describe("prepareLocationSave", () => {
  it("normalizes a valid payload and forwards the landmark as a canonical field", () => {
    const result = prepareLocationSave({
      label: "  Home  ",
      landmark: "  Red gate  ",
      manualAddress: "",
      selected,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload).toMatchObject({
      label: "Home",
      formattedAddress: "Red gate, 12 Marina Road, Lagos",
      latitude: selected.latitude,
      longitude: selected.longitude,
      accuracyMeters: 12,
      landmark: "Red gate",
      captureSource: "GEOCODED",
      providerPlaceId: "place-1",
      source: "skima.lpg.location_api",
    });
    expect(result.payload.metadata.addressComponents.name).toBe("Red gate");
    expect(result.payload.metadata.landmark).toBe("Red gate");
  });

  it("uses the manual address for a generic map result", () => {
    const result = prepareLocationSave({
      label: "Office",
      landmark: "",
      manualAddress: "  5 Broad Street, Lagos  ",
      selected: { ...selected, formattedAddress: "Pinned location", providerSource: "manual_pin" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.formattedAddress).toBe("5 Broad Street, Lagos");
    expect(result.payload.captureSource).toBe("MAP_PIN");
  });

  it.each([
    [{ label: "H", selected }, "Use at least 2 characters"],
    [{ label: "Home", selected: null }, "Choose the location"],
    [{ label: "Home", selected: { ...selected, latitude: 91 } }, "map point is not valid"],
    [{ label: "Home", selected: { ...selected, accuracyMeters: -1 } }, "accuracy is not valid"],
    [{ label: "Home", selected: { ...selected, formattedAddress: "No" } }, "Add a street"],
  ])("rejects a payload that would fail the database contract", (overrides, expected) => {
    const result = prepareLocationSave({
      label: "Home",
      landmark: "",
      manualAddress: "",
      selected,
      ...overrides,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain(expected);
  });

  it("keeps a valid address within the database limit when a long landmark is separate", () => {
    const result = prepareLocationSave({
      label: "Home",
      landmark: "L".repeat(30),
      manualAddress: "",
      selected: { ...selected, formattedAddress: "A".repeat(480) },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.formattedAddress).toHaveLength(480);
    expect(result.payload.landmark).toHaveLength(30);
  });

  it("changes the fingerprint for a distinct location", () => {
    const first = prepareLocationSave({ label: "Home", landmark: "", manualAddress: "", selected });
    const second = prepareLocationSave({
      label: "Home",
      landmark: "",
      manualAddress: "",
      selected: { ...selected, longitude: selected.longitude + 0.001 },
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.fingerprint).not.toBe(first.fingerprint);
  });
});

describe("reuseLocationSaveAttempt", () => {
  it("reuses one key for retries and creates a new key after the payload changes", () => {
    let sequence = 0;
    const createKey = () => `attempt-${++sequence}`;
    const first = reuseLocationSaveAttempt(null, "location-a", createKey);
    const retry = reuseLocationSaveAttempt(first, "location-a", createKey);
    const changed = reuseLocationSaveAttempt(retry, "location-b", createKey);

    expect(retry).toBe(first);
    expect(retry.idempotencyKey).toBe("attempt-1");
    expect(changed.idempotencyKey).toBe("attempt-2");
    expect(sequence).toBe(2);
  });
});
