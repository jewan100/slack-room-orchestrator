module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: "./tsconfig.json",
    tsconfigRootDir: __dirname,
    ecmaVersion: 2022,
    sourceType: "module"
  },
  env: {
    es2022: true,
    node: true
  },
  plugins: ["@typescript-eslint"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking"
  ],
  rules: {
    "prefer-const": "error",
    "max-params": ["error", 4],
    complexity: ["error", 10],
    "max-depth": ["error", 3],
    "no-else-return": ["error", { allowElseIf: false }],
    "max-lines-per-function": ["error", { max: 50, skipBlankLines: true, skipComments: true }],
    "max-lines": ["error", { max: 400, skipBlankLines: true, skipComments: true }],
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/consistent-type-imports": "error",
    "@typescript-eslint/no-floating-promises": "error",
    "@typescript-eslint/await-thenable": "error",
    "@typescript-eslint/explicit-function-return-type": [
      "error",
      {
        allowExpressions: true,
        allowTypedFunctionExpressions: true,
        allowHigherOrderFunctions: false
      }
    ]
  },
  overrides: [
    {
      files: ["tests/**/*.ts"],
      rules: {
        "max-lines-per-function": "off",
        complexity: ["off"],
        "@typescript-eslint/require-await": "off",
        "@typescript-eslint/explicit-function-return-type": "off"
      }
    }
  ]
};
