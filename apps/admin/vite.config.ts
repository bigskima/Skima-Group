import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: resolve(__dirname),
  envDir: resolve(__dirname, "../.."),
  envPrefix: ["VITE_", "SUPABASE_URL", "SUPABASE_ANON_KEY"],
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
  build: {
    emptyOutDir: true,
    outDir: "dist",
    rollupOptions: {
      onwarn(warning, warn) {
        if (
          warning.code === "MODULE_LEVEL_DIRECTIVE" &&
          warning.message.includes('"use client"')
        ) {
          return;
        }

        warn(warning);
      },
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          "data-access": ["@supabase/supabase-js", "@tanstack/react-query", "zod"],
          icons: ["lucide-react"],
        },
      },
    },
    sourcemap: false,
  },
  server: {
    host: "127.0.0.1",
    port: 5174,
  },
});
