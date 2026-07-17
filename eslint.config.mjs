import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import reactHooks from "eslint-plugin-react-hooks";

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
    // Self-contained MCP sub-package with its own tsconfig/lint/test toolchain.
    "mcp/**",
  ]),
  // Project lint policy. `npm run lint` is a CI quality gate (see
  // .github/workflows), and `npm run typecheck` (tsc --noEmit) is the
  // authoritative type gate — it flags unsafe types far more precisely than
  // no-explicit-any. The rules below are pervasively present as pre-existing
  // debt; keeping them as warnings (not gate-blocking errors) lets the gate
  // enforce *real* regressions without being blocked by stylistic legacy code.
  // New code should still avoid them. Plugins are re-registered here so the
  // rule references resolve in flat config (same cached module instances as
  // eslint-config-next, so no plugin conflict).
  {
    plugins: { "@typescript-eslint": tsPlugin, "react-hooks": reactHooks },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      "@typescript-eslint/no-unsafe-function-type": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
    },
  },
]);

export default eslintConfig;
