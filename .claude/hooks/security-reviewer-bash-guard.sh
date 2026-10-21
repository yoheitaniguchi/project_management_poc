#!/usr/bin/env bash
# security-reviewer サブエージェント（.claude/agents/security-reviewer.md）専用のPreToolUseフック。
# サブエージェントのfrontmatterで登録されるため、このサブエージェントが動いている間だけ有効。
#
# security-reviewerは読み取り専用レビューエージェントであり、Bashは監査コマンドの実行にのみ
# 許可する。連結（&&, ||, ;, |）・コマンド置換・リダイレクトを一切禁止し、許可リストに一致
# する単一コマンドだけを通す（部分一致だと `npm audit && rm -rf /` のようなバイパスが成立するため）。
#
# 許可されなかったコマンドはexit 2で拒否し、理由をstderrへ書く（Claude Codeの仕様どおり、
# PreToolUseのexit 2はツール呼び出しをブロックしてstderrをClaudeへフィードバックする）。
set -euo pipefail

INPUT=$(cat)
COMMAND=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty')

if [ -z "$COMMAND" ]; then
  exit 0
fi

# 連結演算子・コマンド置換・リダイレクト・改行を含む場合は無条件で拒否する
if printf '%s' "$COMMAND" | grep -qE '(&&|\|\||;|\||`|\$\(|>|<)' || [[ "$COMMAND" == *$'\n'* ]]; then
  echo "security-reviewer: 複数コマンドの連結・リダイレクトは許可されていません: ${COMMAND}" >&2
  exit 2
fi

# gitleaksはレポートファイルを書き出すオプションを禁止する（読み取り専用を保つため）
if printf '%s' "$COMMAND" | grep -qE '^gitleaks ' && printf '%s' "$COMMAND" | grep -qE '(--report|-r( |=|$))'; then
  echo "security-reviewer: gitleaksのレポート出力オプションは許可されていません: ${COMMAND}" >&2
  exit 2
fi

# 許可リストのコマンドでも、ファイルを書き出す・別コマンドを起動するオプションは禁止する
# （git の --output / --ext-diff / -O、eslint の --fix）
if printf '%s' "$COMMAND" | grep -qE '(--output|--ext-diff|--open-files-in-pager|(^| )-O|--fix)'; then
  echo "security-reviewer: ファイル書き出し・外部コマンド起動のオプションは許可されていません: ${COMMAND}" >&2
  exit 2
fi

# tscは出力を書き出さない --noEmit 付きのときだけ許可する
if printf '%s' "$COMMAND" | grep -qE '^npx tsc' && ! printf '%s' "$COMMAND" | grep -qE -- '--noEmit'; then
  echo "security-reviewer: npx tsc は --noEmit 付きでのみ許可されています: ${COMMAND}" >&2
  exit 2
fi

# 監査・静的解析用途の読み取り専用コマンドのみを許可する
ALLOW_PATTERNS=(
  '^npm audit( .*)?$'
  '^npm outdated( .*)?$'
  '^npm ls( .*)?$'
  '^npm run lint( .*)?$'
  '^npx eslint( .*)?$'
  '^npx tsc( .*)?$'
  '^git log( .*)?$'
  '^git show( .*)?$'
  '^git diff( .*)?$'
  '^git blame( .*)?$'
  '^git grep( .*)?$'
  '^git ls-files( .*)?$'
  '^git check-ignore( .*)?$'
  '^gitleaks (detect|git|dir|protect)( .*)?$'
  '^node --version$'
  '^npm --version$'
)

for pattern in "${ALLOW_PATTERNS[@]}"; do
  if printf '%s' "$COMMAND" | grep -qE "$pattern"; then
    exit 0
  fi
done

echo "security-reviewer: 監査用途の読み取り専用コマンドのみ許可されています。拒否したコマンド: ${COMMAND}" >&2
exit 2
