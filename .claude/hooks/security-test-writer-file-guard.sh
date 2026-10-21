#!/usr/bin/env bash
# security-test-writer サブエージェント（.claude/agents/security-test-writer.md）専用のPreToolUse
# フック（Edit/Write用）。このサブエージェントが動いている間だけ有効。
#
# 「テストファイルのみ編集可能・本番コードは編集不可」を強制するため、file_pathがテストファイルの
# 命名規約（*.test.ts / *.test.tsx / *.test.mjs / *.spec.ts）に一致しない場合は無条件でexit 2にする。
set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty')

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

if printf '%s' "$FILE_PATH" | grep -qE '\.(test\.ts|test\.tsx|test\.mjs|spec\.ts)$'; then
  exit 0
fi

echo "security-test-writer: テストファイル（*.test.ts / *.test.tsx / *.test.mjs / *.spec.ts）以外は編集できません: ${FILE_PATH}" >&2
exit 2
