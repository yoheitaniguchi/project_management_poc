/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** PRプレビューのビルドだけ、CIがPRの番号を渡す（.github/workflows/pr-preview.yml） */
  readonly VITE_PR_PREVIEW?: string;
}
