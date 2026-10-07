import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import next from "eslint-config-next";
import tseslint from "typescript-eslint";

export default defineConfig(
  // Build output, generated files and configs: eslint-config-next sets the TS parser globally,
  // so type-aware rules fail on untyped files like .mjs configs.
  {
    ignores: [
      ".next/**/*",
      "node_modules/**/*",
      "next-env.d.ts",
      "eslint.config.mjs",
      "postcss.config.mjs",
      "next.config.ts",
      ".claude/**/*",
    ],
  },

  js.configs.recommended,

  // Next.js, React and React Hooks rules
  ...next,

  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylistic,

  // Pinned instead of "detect": eslint-plugin-react 7.37.5's detection calls the removed
  // context.getFilename(), which throws under ESLint 10.
  {
    settings: {
      react: { version: "19.2" },
    },
  },

  // Type information for the type-aware rules
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

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

      // Errors, since hand-rolled interactive markup is the norm here: they catch a div with onClick,
      // a role missing its required props, and interactive elements nested inside a button.
      "jsx-a11y/alt-text": "error",
      "jsx-a11y/aria-props": "error",
      "jsx-a11y/aria-role": "error",
      "jsx-a11y/anchor-is-valid": "error",
      "jsx-a11y/click-events-have-key-events": "error",
      "jsx-a11y/interactive-supports-focus": "error",
      "jsx-a11y/no-noninteractive-element-interactions": "error",
      "jsx-a11y/no-redundant-roles": "error",
      "jsx-a11y/no-static-element-interactions": "error",
      "jsx-a11y/role-has-required-aria-props": "error",
      "jsx-a11y/tabindex-no-positive": "error",
      "react/no-unescaped-entities": "off",

      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/immutability": "warn",

      "no-console": ["warn", { allow: ["warn", "error", "debug"] }],

      "no-case-declarations": "warn",
      "no-useless-escape": "warn",
    },
  },
  // Off globally for untyped mysql2 rows, but nothing in app/ or components/ sees
  // one: they consume typed lib results, so `any` there is a real slip.
  {
    files: ["app/**/*.ts", "app/**/*.tsx", "components/**/*.ts", "components/**/*.tsx"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-return": "error",
    },
  },
);
