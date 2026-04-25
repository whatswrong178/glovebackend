import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    open: true,
  },
  build: {
    // Warn if any chunk exceeds 800 kB
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        // Split large vendor chunks for better caching
        manualChunks: {
          "react-vendor": ["react", "react-dom", "react-router-dom"],
          "refine-vendor": [
            "@refinedev/core",
            "@refinedev/supabase",
            "@refinedev/react-router-v6",
          ],
          "chart-vendor": ["recharts", "react-d3-tree"],
        },
      },
    },
  },
});
