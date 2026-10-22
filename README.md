# project_management_poc

PM支援ツールのPoC。計画の基準線（ベースライン）と実績の差を、簡易EVMで見える化する。
開発の指示と方針は [CLAUDE.md](CLAUDE.md) を参照。

- バックエンドを持たない1ページのアプリ（React + TypeScript + Vite）。GitHub Pagesで配信する
- データは利用者のブラウザ（localStorage）と、書き出したJSONファイルにだけ置く。**実データをこのリポジトリにコミットしない**
- 書き出したJSON・CSVや、Asanaから書き出したCSVは、**このリポジトリのフォルダの外**に保存する（`.gitignore`でも除外しているが、念のため）

## コマンド

```bash
npm ci                 # 依存関係のインストール
npm run dev            # 開発サーバー（http://localhost:5173）
npm run lint           # ESLint
npm run typecheck      # 型チェック
npm test               # 単体テスト（全件）
npm run test:security  # @security タグ付きのテストだけ
npm run build          # 型チェック＋本番ビルド（dist/）
npm run preview        # 本番ビルドの動作確認
```

## CI と配信

`.github/workflows/ci.yml` が、PRと `main` へのpushで lint・型チェック・単体テスト・依存の脆弱性検査・gitleaks・ビルドを行う。
`main` へのpushでは、すべて成功したときだけ `gh-pages` ブランチへ配信する（GitHub Pages）。

`.github/workflows/pr-preview.yml` が、PRごとのプレビューを `gh-pages` ブランチの `pr-preview/pr-<番号>/` に配信し、PRにURLをコメントする。PRを閉じると消す。
プレビューのデータは本番と別の名前空間（`project_management_poc-pr-preview-<番号>:`）に保存し、本番の保存データは読み書きしない。
このリポジトリのブランチからのPRだけが対象で、Dependabot のPRにはプレビューを作らない。

初回だけ、リポジトリの設定で次を行う。
1. Settings → Pages → Build and deployment の Source を「Deploy from a branch」、ブランチを `gh-pages` / `(root)` にする（`gh-pages` は最初の配信で作られる）
2. Settings → Rules → Rulesets で `main` のルールを作り、CIのジョブ（test・dependency-audit・secret-scan・build）の成功を必須にする
