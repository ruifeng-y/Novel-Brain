import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "tests/dependency/**/*.test.ts",
      "tests/manuscript/**/*.test.ts",
      "tests/narrative/**/*.test.ts",
      "tests/production/**/*.test.ts",
      "tests/safety/**/*.test.ts",
      "tests/shared/**/*.test.ts",
    ],
    exclude: ["tests/integration/**"],
  },
});
