import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// During development we proxy /api/* to the FastAPI server (default 8000).
// In production the frontend is built as static assets — the API base URL
// comes from VITE_API_BASE_URL (see src/services/api.ts).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Backend serves API under /api/* in both dev and prod so we don't
      // rewrite — the proxy just forwards path-and-all to FastAPI.
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
  build: {
    sourcemap: true,
    // Split large chart + table libs out so the initial bundle stays small.
    rollupOptions: {
      output: {
        manualChunks: {
          recharts: ["recharts"],
          tanstack: ["@tanstack/react-query", "@tanstack/react-table"],
        },
      },
    },
  },
});
