import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: resolve(__dirname),
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: [resolve(__dirname, "src/test/setup.ts")],
  },
  resolve: {
    alias: [
      {
        find: "@skima/ui/styles.css",
        replacement: resolve(__dirname, "../../packages/ui/src/styles.css"),
      },
      {
        find: "@skima/frontend-core",
        replacement: resolve(__dirname, "../../packages/frontend-core/src/index.ts"),
      },
      {
        find: "@skima/ui",
        replacement: resolve(__dirname, "../../packages/ui/src/index.tsx"),
      },
    ],
  },
});
