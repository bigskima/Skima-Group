import type { ConfigContext, ExpoConfig } from "expo/config";
import { config as loadEnvironment } from "dotenv";
import { resolve } from "node:path";

loadEnvironment({
  path: resolve(__dirname, "../../.env"),
  override: false,
  quiet: true,
});

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
        "SKIMA uses your selected locations to find logistics companies that can serve your journey."
    }
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-font",
    ["expo-splash-screen", {
      backgroundColor: "#F7F7F8",
      imageWidth: 180,
      resizeMode: "contain"
    }]
  ],
  extra: {
    apiGatewayUrl: process.env.EXPO_PUBLIC_API_GATEWAY_URL,
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  }
});
