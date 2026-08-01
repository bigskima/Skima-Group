import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: resolve(__dirname),
  envDir: resolve(__dirname, "../.."),
  envPrefix: ["VITE_", "SUPABASE_URL", "SUPABASE_ANON_KEY"],
  resolve: {
    alias: [
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
  build: {
    emptyOutDir: true,
    outDir: "dist",
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          icons: ["lucide-react"],
          contracts: ["zod", "@supabase/supabase-js"],
        },
      },
    },
    sourcemap: false,
  },
  server: {
    host: "127.0.0.1",
    port: 5175,
  },
});
