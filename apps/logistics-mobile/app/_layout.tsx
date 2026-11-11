import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import * as Location from "expo-location";
import { PlatformMaintenanceNotices } from "@skima/mobile-experience/PlatformMaintenanceNotices";
import { AppProviders } from "../src/providers/AppProviders";
import { useAppTheme } from "../src/theme/ThemeProvider";
import { useSession } from "../src/session/SessionProvider";

export default function RootLayout() {
  return <AppProviders><Navigation /></AppProviders>;
}

async function resolveMaintenanceLocation() {
  let permission = await Location.getForegroundPermissionsAsync();
  if (!permission.granted) permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) throw new Error("Location permission was not granted.");

  const point = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });
  let geographyNames: string[] = [];
  let countryCode: string | null = null;
  try {
    const addresses = await Location.reverseGeocodeAsync({
      latitude: point.coords.latitude,
      longitude: point.coords.longitude,
    });
    const address = addresses[0];
    if (address) {
      geographyNames = [
        address.country, address.region, address.subregion,
        address.city, address.district, address.name,
      ].filter((value): value is string => Boolean(value?.trim()));
      countryCode = address.isoCountryCode?.trim().toUpperCase() ?? null;
    }
  } catch {
    // Coordinates remain usable where no device reverse geocoder is available.
  }
  return {
    latitude: point.coords.latitude,
    longitude: point.coords.longitude,
    geographyNames,
    countryCode,
  };
}

function Navigation() {
  const { palette } = useAppTheme();
  const session = useSession();
  return (
    <View style={{ flex: 1, backgroundColor: palette.canvas }}>
      <PlatformMaintenanceNotices
        supabase={session.supabase}
        serviceKeys={["logistics", "payments", "wallets", "notifications"]}
        palette={palette}
        resolveLocation={resolveMaintenanceLocation}
      />
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false, animation: "fade", contentStyle: { backgroundColor: "#F7F7F8" } }} />
    </View>
  );
}
