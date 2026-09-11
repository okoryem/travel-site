import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // infra/ is a separate npm project with its own jest setup; without this
    // Vitest's default glob sweeps in its tests and fails on unresolved imports.
    include: ["src/**/*.test.ts"],
  },
});
