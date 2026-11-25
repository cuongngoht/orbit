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
    //
    // Every store is asynchronous (PostgreSQL): a promise nobody awaits is a write that may fail unseen or land after
    // the answer, so the API is linted WITH its types, and a floating or misused promise is an error.
    files: ["apps/api/src/**/*.ts", "apps/api/tests/**/*.ts"],
    languageOptions: { globals: globals.node, parserOptions: { project: "./apps/api/tsconfig.spec.json", tsconfigRootDir: import.meta.dirname } },
    rules: {
      "@typescript-eslint/consistent-type-imports": "off",
      // node:test's own functions return a promise the runner itself awaits.
      "@typescript-eslint/no-floating-promises": ["error", { allowForKnownSafeCalls: [{ from: "package", package: "node:test", name: ["test", "describe", "it", "suite", "before", "after", "beforeEach", "afterEach"] }] }],
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
      "@typescript-eslint/await-thenable": "error",
    },
  },
  {
    // An effect returns its clean-up or nothing, and React calls whatever it returned when the effect runs again: a
    // value that is no function throws there, and with no boundary the whole page comes down. A body that is an
    // expression returns what the expression answers -- and the browser's own answers move (scrollIntoView() answers a
    // promise now, a type that still says void) -- so an effect's body is a block, unless it is the clean-up itself.
    // (An async effect, the other way to return a promise, is already the hooks rules' own warning.)
    files: ["apps/web/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name=/^use(Layout|Insertion)?Effect$/] > ArrowFunctionExpression[expression=true][body.type!='ArrowFunctionExpression'][body.type!='FunctionExpression']",
          message: "An effect returns its clean-up or nothing: write its body as a block ({ ... }), and `return` a clean-up explicitly. An expression body returns what the expression answers (scrollIntoView() answers a promise now), and React calls it as the clean-up.",
        },
      ],
    },
  },
  {
    files: ["**/*.mjs", "scripts/**", "tests/**/*.mjs", "docker/**/*.mjs"],
    languageOptions: { globals: globals.node },
    rules: { "no-console": "off" },
  },
);
