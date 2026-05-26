import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import next from "eslint-config-next";
import tseslint from "typescript-eslint";

export default defineConfig(
  // Exclude build artifacts, node_modules, generated files, and JS config files.
  // Note: eslint-config-next sets the TypeScript parser globally, which causes
  // type-aware rules to fail on non-TypeScript files like .mjs configs.
  {
    ignores: [
      ".next/**/*",
      "node_modules/**/*",
      "next-env.d.ts",
      "eslint.config.mjs",
      "postcss.config.mjs",
      "next.config.ts",
    ],
  },

  // 1. Base JavaScript recommended rules
  js.configs.recommended,

  // 2. Next.js configuration with React, React Hooks, and Next.js rules
  ...next,

  // 3. TypeScript ESLint strict type-checked + stylistic configurations
  //    These provide ~120+ rules for maximum type safety and code style consistency
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylistic,

  // Configure TypeScript parser globally for type-aware rules
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Custom rule overrides and project-specific tuning
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "error",

      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/consistent-type-imports": "warn",

      "@typescript-eslint/array-type": ["warn", { default: "array-simple" }],
      "@typescript-eslint/consistent-indexed-object-style": "warn",

      "@typescript-eslint/require-await": "warn",
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/await-thenable": "warn",

      "@typescript-eslint/restrict-template-expressions": [
        "warn",
        { allowNumber: true },
      ],

      "@typescript-eslint/no-non-null-assertion": "warn",
      "@typescript-eslint/no-inferrable-types": "warn",
      "@typescript-eslint/no-unnecessary-type-assertion": "warn",
      "@typescript-eslint/no-unnecessary-type-parameters": "warn",
      "@typescript-eslint/no-extraneous-class": "warn",

      // Warn on using Error type instead of unknown (React 19 compat)
      "@typescript-eslint/use-unknown-in-catch-callback-variable": "warn",

      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-unnecessary-condition": "warn",

      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",

      "jsx-a11y/alt-text": "warn",
      "jsx-a11y/aria-props": "warn",
      "react/no-unescaped-entities": "off",

      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/immutability": "warn",

      "no-console": ["warn", { allow: ["warn", "error", "debug"] }],

      // Warn on lexical declarations in case blocks (let/const in switch)
      "no-case-declarations": "warn",

      // Warn on unnecessary escapes
      "no-useless-escape": "warn",
    },
  },
);
