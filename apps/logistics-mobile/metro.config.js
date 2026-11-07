const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");
const config = getDefaultConfig(projectRoot);

config.watchFolders = [path.resolve(workspaceRoot, "packages")];
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  "@skima/frontend-core": path.resolve(workspaceRoot, "packages/frontend-core/src/index.ts"),
  "@supabase/supabase-js": path.resolve(projectRoot, "node_modules/@supabase/supabase-js"),
  "zod": path.resolve(projectRoot, "node_modules/zod"),
  "react": path.resolve(projectRoot, "node_modules/react"),
  "lucide-react-native": path.resolve(projectRoot, "node_modules/lucide-react-native"),
  "expo-image-picker": path.resolve(projectRoot, "node_modules/expo-image-picker")
};

// Use the web-compatible React Native implementation for browser exports.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolvedName = platform === "web" && moduleName === "react-native"
    ? "react-native-web"
    : moduleName;
  return context.resolveRequest(context, resolvedName, platform);
};

module.exports = config;
