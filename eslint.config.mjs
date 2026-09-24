import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  globalIgnores([
    ".next/**",
    ".cache/**",
    "out/**",
    "build/**",
    "dist/**",
    "storage/**",
    "next-env.d.ts",
  ]),

  {
    settings: {
      // Explicit version: eslint-plugin-react auto-detection uses an API removed in ESLint 10.
      react: { version: "19.3" },
      next: {
        rootDir: ["."],
      },
    },
    rules: {
      /**
       * The React Compiler rule flags the ordinary "fetch on mount, then
       * setState" pattern used by every list page here. Without a data-fetching
       * library there is no alternative shape for it, and the extra render it
       * costs is not worth restructuring twenty screens around. Kept as a
       * warning so a genuinely problematic case is still visible.
       */
      "react-hooks/set-state-in-effect": "warn",

      /**
       * Unused arguments are frequently meaningful in this codebase — an adapter
       * implementing a wider interface, or a route handler that receives a
       * context it does not need. Leading-underscore names opt out explicitly.
       */
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
]);

export default eslintConfig;
