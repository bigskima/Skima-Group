import type { ConfigContext, ExpoConfig } from "expo/config";
import { config as loadEnvironment } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

loadEnvironment({ path: resolve(__dirname, "../../.env"), override: false, quiet: true });

const easProjectId = process.env.EXPO_PUBLIC_STORE_EAS_PROJECT_ID?.trim();
const googleServicesCandidate = process.env.SKIMA_STORE_GOOGLE_SERVICES_FILE?.trim() || "./google-services.json";
const googleServicesFile = existsSync(resolve(__dirname, googleServicesCandidate)) ? googleServicesCandidate : undefined;
const androidPackage = process.env.SKIMA_STORE_ANDROID_PACKAGE?.trim() || "com.skima.store";
const iosBundleIdentifier = process.env.SKIMA_STORE_IOS_BUNDLE_ID?.trim() || "com.skima.store";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "SKIMA Store",
  slug: "skima-store",
  scheme: "skima-store",
  version: "1.0.0",
  icon: "./assets/skima-splash-logo.png",
  orientation: "default",
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  experiments: { typedRoutes: true },
  web: { bundler: "metro", output: "single", name: "SKIMA Store", shortName: "SKIMA Store", themeColor: "#E21D2F", backgroundColor: "#F7F7F8" },
  android: { package: androidPackage, ...(googleServicesFile ? { googleServicesFile } : {}), adaptiveIcon: { foregroundImage: "./assets/skima-splash-logo.png", backgroundColor: "#F7F7F8" }, permissions: ["POST_NOTIFICATIONS"] },
  ios: { bundleIdentifier: iosBundleIdentifier, supportsTablet: true },
  plugins: ["expo-router", "expo-secure-store", ["expo-notifications", { defaultChannel: "store", color: "#E21D2E", enableRemoteNotifications: true }], ["expo-splash-screen", { image: "./assets/skima-splash-logo.png", imageWidth: 180, backgroundColor: "#F7F7F8", resizeMode: "contain", dark: { backgroundColor: "#111113", image: "./assets/skima-splash-logo.png" } }]],
  extra: {
    apiGatewayUrl: process.env.EXPO_PUBLIC_API_GATEWAY_URL,
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    storeBaseUrl: process.env.EXPO_PUBLIC_SKIMA_STORE_BASE_URL,
    ...(easProjectId ? { eas: { projectId: easProjectId } } : {}),
    appIdentityStatus: easProjectId ? "eas_project_configured" : "eas_project_required",
  },
});
