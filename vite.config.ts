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

    // P2-1: Use terser for more aggressive minification + variable mangling.
    // esbuild (default) minifies syntax but preserves readable variable names.
    // terser mangles names and strips console.* calls entirely.
    minify: "terser",
    terserOptions: {
      compress: {
        // Strip all console.log / console.warn / console.error from prod bundle
        drop_console: true,
        drop_debugger: true,
        // Additional passes for better dead-code elimination
        passes: 2,
      },
      mangle: {
        // Mangle all local variable names
        toplevel: false, // keep top-level exports intact (Refine routing needs them)
      },
      format: {
        // Remove all comments from output
        comments: false,
      },
    },
  },
});
