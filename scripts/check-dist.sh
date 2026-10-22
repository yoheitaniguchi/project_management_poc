#!/usr/bin/env sh
# ビルド成果物（dist）にデータファイルが無いことを確かめる（CLAUDE.md 6.1 公開に関する注意）。
# 本番の配信とPRプレビューの両方で、配信の前に実行する
set -eu
[ -d dist ] || { echo "dist がありません" >&2; exit 1; }
if find dist -type f \( -name '*.json' -o -name '*.csv' -o -name '*.tsv' -o -name 'pmpoc-*' \) | grep .; then
  echo "dist にデータファイルが含まれています" >&2
  exit 1
fi
