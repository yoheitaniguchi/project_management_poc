import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["dist", "coverage", "test-results"],
  },
  {
    files: ["**/*.{ts,tsx,js}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // 未使用の変数はtsconfigのnoUnusedLocals/noUnusedParametersで検出する
      "@typescript-eslint/no-unused-vars": "off",
      // 読み込むファイルの検証は unknown と型ガードで行い、any で検証をすり抜けない（docs/security/checklist.md C）
      "@typescript-eslint/no-explicit-any": "error",
      // 入力値をHTMLとして挿入しない（docs/security/checklist.md C）。
      // eslint-plugin-react を追加せずに済むよう、構文の制限で禁止する
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: "dangerouslySetInnerHTML は使わない（入力値はテキストとして表示する）",
        },
      ],
    },
  },
);
