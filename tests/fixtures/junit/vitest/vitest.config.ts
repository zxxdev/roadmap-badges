// Runs only the example suite in this folder, for generate.sh.
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: import.meta.dirname,
  test: { include: ["*.sample.ts"] },
});
