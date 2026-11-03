import type { ConfigContext, ExpoConfig } from "expo/config";
import { config as loadEnvironment } from "dotenv";
import { resolve } from "node:path";

loadEnvironment({
  path: resolve(__dirname, "../../.env"),
  override: false,
  quiet: true,
});

const easProjectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim();

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "SKIMA Logistics",
  slug: "skima-logistics",
  scheme: "skima-logistics",
  version: "1.0.0",
  orientation: "default",
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  experiments: { typedRoutes: true },
  web: {
    bundler: "metro",
    output: "single",
    name: "SKIMA Logistics",
    shortName: "SKIMA Logistics",
    themeColor: "#E21D2F",
    backgroundColor: "#F7F7F8"
  },
  android: {
    package: "com.skima.logistics",
    permissions: ["ACCESS_COARSE_LOCATION", "ACCESS_FINE_LOCATION", "POST_NOTIFICATIONS"]
  },
  ios: {
    bundleIdentifier: "com.skima.logistics",
    supportsTablet: true,
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        "SKIMA Logistics uses your location to share progress with the customer during an active delivery."
    }
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-font",
    ["expo-location", {
      locationWhenInUsePermission:
        "Allow SKIMA Logistics to share your location with the customer while you fulfil an active delivery."
    }],
    ["expo-splash-screen", {
      backgroundColor: "#F7F7F8",
      imageWidth: 180,
      resizeMode: "contain"
    }]
  ],
  extra: {
    apiGatewayUrl: process.env.EXPO_PUBLIC_API_GATEWAY_URL,
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    ...(easProjectId ? { eas: { projectId: easProjectId } } : {})
  }
});
