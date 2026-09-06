import * as Location from "expo-location";

export interface OperationalLocation {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  recordedAt: string;
  formattedAddress: string;
  providerPlaceId?: string | null;
  providerSource: "device_geocoder" | "device_coordinates" | "maps_adapter" | "manual_pin";
  address: OperationalAddress;
}

export interface OperationalAddress {
  name: string | null;
  street: string | null;
  district: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  countryCode: string | null;
  neighbourhood?: string | null;
  town?: string | null;
  village?: string | null;
  lga?: string | null;
  state?: string | null;
  stateCode?: string | null;
}

export async function readOperationalLocation(options: { requestPermission?: boolean } = {}) {
  let permission = await Location.getForegroundPermissionsAsync();
  if (!permission.granted && options.requestPermission !== false)
    permission = await Location.requestForegroundPermissionsAsync();

  if (!permission.granted) {
    const message = permission.canAskAgain
      ? "Location access wasn't allowed. You can search for an address instead."
      : "Location access is blocked in your device settings. You can search for an address instead.";
    throw new Error(message);
  }

  const point = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Highest,
    mayShowUserSettingsDialog: true,
  });
  const latitude = point.coords.latitude;
  const longitude = point.coords.longitude;
  if (!validCoordinate(latitude, longitude))
    throw new Error("Your device returned an invalid location. Search for your address instead.");

  const resolved = await resolveOperationalAddress(latitude, longitude);
  return {
    latitude,
    longitude,
    accuracyMeters: finiteAccuracy(point.coords.accuracy),
    recordedAt: new Date(point.timestamp).toISOString(),
    formattedAddress: resolved.formattedAddress ?? "Selected map location",
    providerSource: resolved.formattedAddress
      ? "device_geocoder" as const
      : "device_coordinates" as const,
    providerPlaceId: null,
    address: resolved.address,
  };
}

export async function resolveOperationalAddress(latitude: number, longitude: number) {
  let address = emptyOperationalAddress();
  let formattedAddress: string | null = null;
  try {
    const addresses = await Location.reverseGeocodeAsync({ latitude, longitude });
    const result = addresses[0];
    if (result) {
      address = readAddress(result);
      formattedAddress = clean(result.formattedAddress) ?? formatOperationalAddress(address);
    }
  } catch {
    // Some web browsers provide GPS without a device-level reverse geocoder.
  }
  return { address, formattedAddress: formattedAddress ?? formatOperationalAddress(address) };
}

export async function geocodeOperationalAddress(value: string): Promise<OperationalLocation | null> {
  const query = value.trim();
  if (!query) return null;
  try {
    const permission = await Location.getForegroundPermissionsAsync();
    const resolvedPermission = permission.granted
      ? permission
      : await Location.requestForegroundPermissionsAsync();
    if (!resolvedPermission.granted) return null;
    const points = await Location.geocodeAsync(query);
    const point = points.find((candidate) => validCoordinate(candidate.latitude, candidate.longitude));
    if (!point) return null;
    const resolved = await resolveOperationalAddress(point.latitude, point.longitude);
    return {
      latitude: point.latitude,
      longitude: point.longitude,
      accuracyMeters: finiteAccuracy(point.accuracy ?? null),
      recordedAt: new Date().toISOString(),
      formattedAddress: resolved.formattedAddress ?? query,
      providerSource: "device_geocoder",
      providerPlaceId: null,
      address: resolved.address,
    };
  } catch {
    return null;
  }
}

export function emptyOperationalAddress(): OperationalAddress {
  return {
    name: null,
    street: null,
    district: null,
    city: null,
    region: null,
    postalCode: null,
    country: null,
    countryCode: null,
  };
}

function readAddress(address: Location.LocationGeocodedAddress): OperationalAddress {
  const street = uniqueParts([address.streetNumber, address.street]).join(" ") || null;
  return {
    name: clean(address.name),
    street,
    district: clean(address.district) ?? clean(address.subregion),
    city: clean(address.city),
    region: clean(address.region),
    postalCode: clean(address.postalCode),
    country: clean(address.country),
    countryCode: clean(address.isoCountryCode),
    neighbourhood: clean(address.district),
    lga: clean(address.subregion),
    state: clean(address.region),
  };
}

export function formatOperationalAddress(address: OperationalAddress) {
  return uniqueParts([
    address.name,
    address.street,
    address.district,
    address.city,
    address.region,
    address.postalCode,
    address.country,
  ]).join(", ") || null;
}

function uniqueParts(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const part = clean(value);
    if (!part) return [];
    const key = part.toLocaleLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    return [part];
  });
}

function clean(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function validCoordinate(latitude: number, longitude: number) {
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && Math.abs(latitude) <= 90
    && Math.abs(longitude) <= 180;
}

function finiteAccuracy(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
