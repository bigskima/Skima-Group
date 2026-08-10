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
  name: "SKIMA LPG",
  slug: "skima-lpg",
  scheme: "skima-lpg",
  version: "1.0.0",
  orientation: "default",
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  experiments: { typedRoutes: true },
  web: { bundler: "metro", output: "static" },
  android: {
    package: "com.skima.lpg",
    blockedPermissions: ["android.permission.RECORD_AUDIO"],
    permissions: [
      "CAMERA",
      "ACCESS_COARSE_LOCATION",
      "ACCESS_FINE_LOCATION",
      "ACCESS_BACKGROUND_LOCATION",
      "POST_NOTIFICATIONS",
    ],
  },
  ios: {
    bundleIdentifier: "com.skima.lpg",
    supportsTablet: true,
    infoPlist: {
      NSCameraUsageDescription:
        "SKIMA uses the camera to scan cylinder codes and capture authorised media.",
      NSLocationWhenInUseUsageDescription:
        "SKIMA uses your location for delivery, station discovery and active fulfilment.",
      NSLocationAlwaysAndWhenInUseUsageDescription:
        "Active drivers may share location during an assigned job.",
      NSPhotoLibraryUsageDescription:
        "SKIMA lets you select authorised cylinder, vehicle and station media.",
    },
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    [
      "expo-camera",
      {
        cameraPermission:
          "Allow SKIMA to scan codes and capture authorised media.",
        recordAudioAndroid: false,
      },
    ],
    [
      "expo-image-picker",
      { photosPermission: "Allow SKIMA to select authorised media." },
    ],
    [
      "expo-location",
      {
        locationWhenInUsePermission:
          "Allow SKIMA to use your location during fulfilment.",
        locationAlwaysAndWhenInUsePermission:
          "Allow SKIMA to share an active driver's location during assigned work.",
      },
    ],
    ["expo-notifications", { defaultChannel: "operations" }],
    "expo-sharing",
    "expo-splash-screen",
    "expo-font",
  ],
  extra: {
    apiGatewayUrl: process.env.EXPO_PUBLIC_API_GATEWAY_URL,
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    ...(easProjectId ? { eas: { projectId: easProjectId } } : {}),
  },
});
