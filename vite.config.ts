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
    // Let Vite handle code splitting automatically — manual chunks caused
    // circular chunk: react-vendor ↔ refine-vendor → React undefined at runtime
    chunkSizeWarningLimit: 1000,
  },
});
