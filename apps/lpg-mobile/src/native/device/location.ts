import * as Location from "expo-location";
export async function readOperationalLocation() {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) throw new Error("Location permission is required for this verification.");
  const point = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  return { latitude: point.coords.latitude, longitude: point.coords.longitude, accuracyMeters: point.coords.accuracy, recordedAt: new Date(point.timestamp).toISOString() };
}
