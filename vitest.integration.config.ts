import { defineConfig } from "vitest/config";

process.env.DATABASE_URL ??=
  "postgresql://novelbrain:novelbrain@localhost:5434/novelbrain_test?schema=public";

export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 30000,
    fileParallelism: false,
  },
});
