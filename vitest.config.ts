import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 15_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      include: ["src/**/*.ts"],
      // CLI entry, the bin shim and the dashboard (plain JS assets + a thin
      // static server) are exercised by smoke runs, not unit tests.
      exclude: ["src/bin.ts", "src/cli.ts", "src/dashboard/**", "src/**/types.ts"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
});
