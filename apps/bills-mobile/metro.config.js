const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const root = path.resolve(__dirname, "../..");
const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(root, "packages"), path.resolve(root, "apps/lpg-mobile")];
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  "@skima/frontend-core": path.resolve(root, "packages/frontend-core/src/index.ts"),
  "@supabase/supabase-js": path.resolve(__dirname, "node_modules/@supabase/supabase-js"),
  "zod": path.resolve(__dirname, "node_modules/zod")
};
module.exports = config;
