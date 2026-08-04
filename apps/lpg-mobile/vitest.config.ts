import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: resolve(__dirname),
  resolve: {
    alias: [
      {
        find: "@lpg",
        replacement: resolve(__dirname, "src"),
      },
      {
        find: "@skima/frontend-core",
        replacement: resolve(__dirname, "../../packages/frontend-core/src/index.ts"),
      },
      {
        find: "@skima/mobile-design",
        replacement: resolve(__dirname, "../../packages/mobile-design/src/index.ts"),
      },
    ],
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
