import * as Location from "expo-location";

export interface OperationalLocation {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  recordedAt: string;
  formattedAddress: string;
  providerSource: "device_geocoder" | "device_coordinates";
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

  let formattedAddress: string | null = null;
  try {
    const addresses = await Location.reverseGeocodeAsync({ latitude, longitude });
    formattedAddress = addresses[0] ? formatAddress(addresses[0]) : null;
  } catch {
    // Some web browsers expose coordinates but not an operating-system geocoder.
  }

  return {
    latitude,
    longitude,
    accuracyMeters: point.coords.accuracy,
    recordedAt: new Date(point.timestamp).toISOString(),
    formattedAddress: formattedAddress ?? `Device location ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
    providerSource: formattedAddress ? "device_geocoder" as const : "device_coordinates" as const,
  };
}

function formatAddress(address: Location.LocationGeocodedAddress) {
  const pieces = [
    address.name,
    address.street && address.street !== address.name ? address.street : null,
    address.district,
    address.city ?? address.subregion,
    address.region,
    address.postalCode,
    address.country,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  return Array.from(new Set(pieces)).join(", ") || null;
}
