// ビルドの種類（本番か、PRプレビューか）。PRプレビューはCIが VITE_PR_PREVIEW にPRの番号を入れてビルドする

/** PRの番号として正しい値だけを受け付ける。それ以外（本番・開発・テスト）は null */
export function parsePreviewPr(value: unknown): number | null {
  return typeof value === "string" && /^[1-9][0-9]{0,6}$/.test(value) ? Number(value) : null;
}

/** PRプレビューのビルドなら、そのPRの番号 */
export const PREVIEW_PR: number | null = parsePreviewPr(import.meta.env.VITE_PR_PREVIEW);
