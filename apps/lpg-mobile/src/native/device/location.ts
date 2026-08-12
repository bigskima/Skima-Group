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
}

export async function readOperationalLocation() {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) throw new Error("Location permission is required. Enable it in your browser or device settings, then try again.");
  const point = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Highest,
    mayShowUserSettingsDialog: true,
  });
  const latitude = point.coords.latitude;
  const longitude = point.coords.longitude;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new Error("The device returned an invalid location.");
  }

  const resolved = await resolveOperationalAddress(latitude, longitude);
  const formattedAddress = resolved.formattedAddress;
  const resolvedAddress = resolved.address;

  return {
    latitude,
    longitude,
    accuracyMeters: point.coords.accuracy,
    recordedAt: new Date(point.timestamp).toISOString(),
    formattedAddress: formattedAddress ?? "Selected map location",
    providerSource: formattedAddress ? "device_geocoder" as const : "device_coordinates" as const,
    providerPlaceId: null,
    address: resolvedAddress,
  };
}

export async function resolveOperationalAddress(latitude: number, longitude: number) {
  let address = emptyOperationalAddress();
  try {
    const addresses = await Location.reverseGeocodeAsync({ latitude, longitude });
    if (addresses[0]) address = readAddress(addresses[0]);
  } catch {
    // Web browsers commonly expose GPS without an operating-system geocoder.
  }
  return { address, formattedAddress: formatAddress(address) };
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
  return {
    name: address.name ?? null,
    street: address.street ?? null,
    district: address.district ?? address.subregion ?? null,
    city: address.city ?? address.subregion ?? null,
    region: address.region ?? null,
    postalCode: address.postalCode ?? null,
    country: address.country ?? null,
    countryCode: address.isoCountryCode ?? null,
  };
}

export function formatOperationalAddress(address: OperationalAddress) {
  const pieces = [
    address.name,
    address.street && address.street !== address.name ? address.street : null,
    address.district,
    address.city,
    address.region,
    address.postalCode,
    address.country,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  return Array.from(new Set(pieces)).join(", ") || null;
}

function formatAddress(address: OperationalAddress) {
  return formatOperationalAddress(address);
}
