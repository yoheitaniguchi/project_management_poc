#!/usr/bin/env bash
# security-test-writer サブエージェント専用のPreToolUseフック（Bash用）。
# 追加したテストが実際に動く（脆弱性があれば失敗する）ことをこのサブエージェント自身が確認できるよう、
# テスト実行・型チェック・lintのコマンドだけを許可する。security-reviewer用フックと同様、
# 連結演算子・コマンド置換・リダイレクトは無条件で拒否する。
# 技術スタックはCLAUDE.md 6.1の推奨案（TypeScript・Vitest）を前提にしている。確定した構成が異なる場合は
# 許可リストを見直すこと。
set -euo pipefail

INPUT=$(cat)
COMMAND=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty')

if [ -z "$COMMAND" ]; then
  exit 0
fi

if printf '%s' "$COMMAND" | grep -qE '(&&|\|\||;|\||`|\$\(|>|<)' || [[ "$COMMAND" == *$'\n'* ]]; then
  echo "security-test-writer: 複数コマンドの連結・リダイレクトは許可されていません: ${COMMAND}" >&2
  exit 2
fi

ALLOW_PATTERNS=(
  '^npm test( .*)?$'
  '^npm run test:security( .*)?$'
  '^npm run lint( .*)?$'
  '^npx vitest run( .*)?$'
  '^npx tsc( .*)?$'
)

for pattern in "${ALLOW_PATTERNS[@]}"; do
  if printf '%s' "$COMMAND" | grep -qE "$pattern"; then
    exit 0
  fi
done

echo "security-test-writer: テスト実行・型チェック・lint以外のコマンドは許可されていません。拒否したコマンド: ${COMMAND}" >&2
exit 2
