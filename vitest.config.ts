import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Explicit config: the codebase imports through the `@/` alias everywhere and
// every test targets server-side modules, so the default (alias-less, jsdom-
// guessing) Vitest setup cannot resolve them.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}", "scripts/**/*.test.ts"],
    globals: false,
    restoreMocks: true,
  },
});
