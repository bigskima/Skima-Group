import * as Linking from "expo-linking";
import { Platform } from "react-native";

export type NavigationTarget = {
  latitude: number;
  longitude: number;
  label: string;
};

export async function openDeviceNavigation(target: NavigationTarget) {
  const configured = process.env.EXPO_PUBLIC_NAVIGATION_URL_TEMPLATE;
  const url = configured
    ? configured
        .replace("{latitude}", encodeURIComponent(String(target.latitude)))
        .replace("{longitude}", encodeURIComponent(String(target.longitude)))
        .replace("{label}", encodeURIComponent(target.label))
    : Platform.select({
        ios: `https://maps.apple.com/?daddr=${target.latitude},${target.longitude}&dirflg=d`,
        default: `https://www.google.com/maps/dir/?api=1&destination=${target.latitude},${target.longitude}&travelmode=driving`,
      });
  if (!url || !(await Linking.canOpenURL(url))) {
    throw new Error("Navigation is unavailable on this device. Copy the address and open it in your preferred map app.");
  }
  await Linking.openURL(url);
}
