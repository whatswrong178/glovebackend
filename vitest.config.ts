import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    // Run in Node environment (no DOM needed for pure financial functions)
    environment: "node",

    // All test files under src/tests/ or any *.test.ts file
    include: ["src/tests/**/*.test.ts", "src/**/*.test.ts"],

    // Coverage configuration — enforces 100% on financial modules
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      reportsDirectory: "./coverage",

      // Files that MUST reach 100% coverage (EPIC-06 commission engine)
      include: [
        "src/lib/commission/**",
        "src/lib/promo/**",
        "src/lib/neglect/**",
      ],

      // Thresholds: CI fails if any financial lib drops below 100%
      thresholds: {
        "src/lib/commission/**": {
          statements: 100,
          branches:   100,
          functions:  100,
          lines:      100,
        },
        "src/lib/promo/**": {
          statements: 100,
          branches:   100,
          functions:  100,
          lines:      100,
        },
      },
    },

    // Globals (describe, it, expect) available without imports
    globals: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
