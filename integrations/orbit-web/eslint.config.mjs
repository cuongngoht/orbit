// Orbit Web's lint: the recommended rules of ESLint and typescript-eslint for every TypeScript file, and the
// rules of hooks for the React app. Syntax-only (no type-aware rules), so it runs in seconds.
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/.spec-dist/**", "**/node_modules/**", "**/coverage/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mts}"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports", fixStyle: "inline-type-imports" }],
      eqeqeq: ["error", "always"],
      "no-console": "error",
    },
  },
  {
    // Nest resolves a provider by the CLASS a constructor names, which emitDecoratorMetadata reads at run time:
    // an import used only in a constructor's signature must stay a value import there.
    files: ["apps/api/src/**/*.ts", "apps/api/tests/**/*.ts"],
    languageOptions: { globals: globals.node },
    rules: { "@typescript-eslint/consistent-type-imports": "off" },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    files: ["**/*.mjs", "scripts/**", "tests/**/*.mjs", "docker/**/*.mjs"],
    languageOptions: { globals: globals.node },
    rules: { "no-console": "off" },
  },
);
