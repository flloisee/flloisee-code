import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // AppleDouble sidecars. The external drive this repo lives on creates a
    // ._name file beside anything written to it, and each is a binary resource
    // fork that eslint tries to parse as TypeScript — failing on a file that
    // holds no source at all. Tests and the build already skip these; lint did
    // not, so every edited file made `pnpm lint` fail for a reason unrelated to
    // the edit.
    "**/._*",
  ]),
]);

export default eslintConfig;
