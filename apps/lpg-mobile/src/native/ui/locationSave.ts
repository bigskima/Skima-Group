import type { OperationalAddress, OperationalLocation } from "../device/location";

const LABEL_MIN_LENGTH = 2;
const LABEL_MAX_LENGTH = 80;
const ADDRESS_MIN_LENGTH = 5;
const ADDRESS_MAX_LENGTH = 500;

type SaveLocation = Omit<OperationalLocation, "address"> & {
  address?: OperationalAddress | null;
};

export interface LocationSaveDraft {
  label: string;
  landmark: string;
  manualAddress: string;
  selected: SaveLocation | null;
}

export interface LocationSavePayload {
  label: string;
  formattedAddress: string;
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  address: OperationalAddress;
  captureSource: "DEVICE_GPS" | "MAP_PIN" | "GEOCODED";
  capturedAt?: string;
  providerSource: OperationalLocation["providerSource"];
  providerPlaceId?: string;
  landmark?: string;
  metadata: {
    addressComponents: OperationalAddress;
    landmark?: string;
    recordedAt?: string;
  };
  source: "skima.lpg.location_api";
}

export type LocationSavePreparation =
  | {
      ok: true;
      fingerprint: string;
      payload: LocationSavePayload;
    }
  | {
      ok: false;
      message: string;
      requiresManualAddress?: boolean;
    };

export interface LocationSaveAttempt {
  fingerprint: string;
  idempotencyKey: string;
}

export function prepareLocationSave(draft: LocationSaveDraft): LocationSavePreparation {
  const label = draft.label.trim();
  if (label.length < LABEL_MIN_LENGTH) {
    return { ok: false, message: "Use at least 2 characters to name this place." };
  }
  if (label.length > LABEL_MAX_LENGTH) {
    return { ok: false, message: "Keep the place name to 80 characters or fewer." };
  }

  const selected = draft.selected;
  if (!selected) {
    return { ok: false, message: "Choose the location on the map before saving it." };
  }
  if (!validCoordinate(selected.latitude, selected.longitude)) {
    return { ok: false, message: "That map point is not valid. Choose the location again." };
  }
  if (
    selected.accuracyMeters !== null
    && (!Number.isFinite(selected.accuracyMeters) || selected.accuracyMeters < 0)
  ) {
    return { ok: false, message: "The location accuracy is not valid. Choose the location again." };
  }

  const useManualAddress = isGenericAddress(selected.formattedAddress);
  const baseAddress = (useManualAddress ? draft.manualAddress : selected.formattedAddress).trim();
  if (baseAddress.length < ADDRESS_MIN_LENGTH) {
    return {
      ok: false,
      message: "Add a street, building or nearby landmark so your driver can find you.",
      requiresManualAddress: true,
    };
  }
  if (baseAddress.length > ADDRESS_MAX_LENGTH) {
    return {
      ok: false,
      message: "Keep the address to 500 characters or fewer.",
      requiresManualAddress: useManualAddress,
    };
  }

  const landmark = draft.landmark.trim();
  const addressWithLandmark = landmark
    && !baseAddress.toLocaleLowerCase().includes(landmark.toLocaleLowerCase())
    ? `${landmark}, ${baseAddress}`
    : baseAddress;
  // The landmark has its own canonical field. If combining it with an otherwise
  // valid address would exceed the database limit, preserve it separately.
  const formattedAddress = addressWithLandmark.length <= ADDRESS_MAX_LENGTH
    ? addressWithLandmark
    : baseAddress;
  const address = normalizeAddress(selected.address);
  const addressComponents = {
    ...address,
    name: landmark || address.name,
  };
  const recordedAt = validTimestamp(selected.recordedAt)
    ? selected.recordedAt
    : undefined;
  const payload: LocationSavePayload = {
    label,
    formattedAddress,
    latitude: selected.latitude,
    longitude: selected.longitude,
    accuracyMeters: selected.accuracyMeters ?? undefined,
    address,
    captureSource: canonicalCaptureSource(selected.providerSource),
    capturedAt: recordedAt,
    providerSource: selected.providerSource,
    providerPlaceId: clean(selected.providerPlaceId) ?? undefined,
    landmark: landmark || undefined,
    metadata: {
      addressComponents,
      landmark: landmark || undefined,
      recordedAt,
    },
    source: "skima.lpg.location_api",
  };

  return {
    ok: true,
    payload,
    fingerprint: JSON.stringify(payload),
  };
}

export function reuseLocationSaveAttempt(
  current: LocationSaveAttempt | null,
  fingerprint: string,
  createIdempotencyKey: () => string,
): LocationSaveAttempt {
  if (current?.fingerprint === fingerprint) return current;
  return { fingerprint, idempotencyKey: createIdempotencyKey() };
}

function normalizeAddress(address: OperationalAddress | null | undefined): OperationalAddress {
  return {
    name: clean(address?.name),
    street: clean(address?.street),
    district: clean(address?.district),
    city: clean(address?.city),
    region: clean(address?.region),
    postalCode: clean(address?.postalCode),
    country: clean(address?.country),
    countryCode: clean(address?.countryCode),
    neighbourhood: clean(address?.neighbourhood),
    town: clean(address?.town),
    village: clean(address?.village),
    lga: clean(address?.lga),
    state: clean(address?.state),
    stateCode: clean(address?.stateCode),
  };
}

function canonicalCaptureSource(
  source: OperationalLocation["providerSource"],
): "DEVICE_GPS" | "MAP_PIN" | "GEOCODED" {
  if (source === "manual_pin") return "MAP_PIN";
  if (source === "maps_adapter") return "GEOCODED";
  return "DEVICE_GPS";
}

function isGenericAddress(value: string) {
  const normalized = value.trim();
  return normalized === "Selected map location"
    || normalized === "Pinned location"
    || normalized.startsWith("Device location");
}

function validCoordinate(latitude: number, longitude: number) {
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && Math.abs(latitude) <= 90
    && Math.abs(longitude) <= 180;
}

function validTimestamp(value: string) {
  return value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

function clean(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
