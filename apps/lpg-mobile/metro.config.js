const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");
const config = getDefaultConfig(projectRoot);

config.watchFolders = [path.resolve(workspaceRoot, "packages")];
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  "@skima/frontend-core": path.resolve(workspaceRoot, "packages/frontend-core/src/index.ts"),
  "@lpg": path.resolve(projectRoot, "src"),
  "@supabase/supabase-js": path.resolve(projectRoot, "node_modules/@supabase/supabase-js"),
  "zod": path.resolve(projectRoot, "node_modules/zod")
};

module.exports = config;
