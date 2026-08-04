import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: resolve(__dirname),
  envDir: resolve(__dirname, "../.."),
  envPrefix: ["VITE_", "SUPABASE_URL", "SUPABASE_ANON_KEY"],
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
  build: {
    emptyOutDir: true,
    outDir: "dist",
    rollupOptions: {
      output: {
        manualChunks: {
          contracts: ["zod", "@supabase/supabase-js"],
          icons: ["lucide-react"],
          react: ["react", "react-dom"],
        },
      },
    },
    sourcemap: false,
  },
  server: {
    host: "127.0.0.1",
    port: 5176,
  },
});
