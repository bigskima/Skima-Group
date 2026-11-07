const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const root = path.resolve(__dirname, "../..");
const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(root, "packages")];
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  "@skima/frontend-core": path.resolve(root, "packages/frontend-core/src/index.ts"),
  "@supabase/supabase-js": path.resolve(__dirname, "node_modules/@supabase/supabase-js"),
  "zod": path.resolve(__dirname, "node_modules/zod"),
  "react": path.resolve(__dirname, "node_modules/react"),
  "lucide-react-native": path.resolve(__dirname, "node_modules/lucide-react-native"),
  "expo-image-picker": path.resolve(__dirname, "node_modules/expo-image-picker")
};
// Use the web-compatible React Native implementation for browser exports.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolvedName = platform === "web" && moduleName === "react-native"
    ? "react-native-web"
    : moduleName;
  return context.resolveRequest(context, resolvedName, platform);
};

module.exports = config;
