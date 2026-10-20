import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "core",
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/__tests__/setup.ts"]
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src")
    }
  }
});
