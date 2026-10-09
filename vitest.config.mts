import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: [
    "app/**/*.test.ts",
    "components/**/*.test.{ts,tsx}",
    "lib/**/*.test.ts",
  ],
    // macOS writes AppleDouble resource forks as `._<name>` alongside real files
    // on volumes without native extended-attribute support (external SSDs, exFAT).
    // They match the globs above and fail to transform, so the suite breaks
    // whenever a merge or checkout lands. Already gitignored; excluded here too
    // so a stray one cannot fail a run.
    exclude: ["**/node_modules/**", "**/._*"],
  },
});