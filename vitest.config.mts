import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    // Node by default: Route Handlers and registry logic need no DOM.
    // Component tests opt into jsdom with a @vitest-environment docblock.
    environment: "node",
    include: [
      "app/**/*.test.{ts,tsx}",
      "lib/**/*.test.{ts,tsx}",
      "components/**/*.test.{ts,tsx}",
    ],
    // macOS writes AppleDouble resource forks as `._<name>` alongside real files
    // on volumes without native extended-attribute support (external SSDs, exFAT).
    // They match the globs above and fail to transform, so the suite breaks
    // whenever a merge or checkout lands. Already gitignored; excluded here too
    // so a stray one cannot fail a run.
    exclude: ["**/node_modules/**", "**/._*"],
  },
});