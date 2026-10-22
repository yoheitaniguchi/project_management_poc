// JSONの書き出しを促すかの判定（CLAUDE.md 6.1：毎週、スナップショットの作成後に書き出したものが正式な記録）。
// 画面から切り離した純粋な関数
import { createInitialState, type AppState } from "./types";
import { timeOf } from "./validate";

export type ExportReminder =
  | { kind: "ok" }
  /** 書き出すデータがまだ無い（初期状態のまま） */
  | { kind: "nothingYet" }
  | { kind: "never" }
  | { kind: "stale"; days: number }
  /** 確定済みの記録（ベースライン・承認と差戻し・週次スナップショット）を作った後に書き出していない */
  | { kind: "afterRecord"; record: string }
  /** 書き出し日時が今より後（端末の時計のずれ・手で編集したファイル）。正しく判定できないので書き出しを促す */
  | { kind: "futureExport" };

export const STALE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 初期状態から何か入力・記録したか（書き出し日時は除いて比べる） */
export function hasAnyData(state: AppState): boolean {
  return JSON.stringify({ ...state, lastExportedAt: null }) !== JSON.stringify(createInitialState());
}

export function exportReminder(state: AppState, now: Date): ExportReminder {
  if (state.lastExportedAt === null) return hasAnyData(state) ? { kind: "never" } : { kind: "nothingYet" };
  const exportedAt = timeOf(state.lastExportedAt);
  if (exportedAt > now.getTime()) return { kind: "futureExport" };

  const records: { label: string; at: string }[] = [
    ...state.baselines.map((b) => ({ label: `ベースラインv${b.version}の確定`, at: b.operatedAt })),
    ...state.gateReviews.map((g) => ({ label: g.decision === "approved" ? "G1+2承認" : "G1+2の差戻し", at: g.operatedAt })),
    ...state.evmSnapshots.map((e) => ({ label: `週次スナップショット（${e.asOf}）の作成`, at: e.createdAt })),
  ];
  const latest = records.reduce<{ label: string; at: number } | null>((acc, r) => {
    const at = timeOf(r.at);
    return acc === null || at > acc.at ? { label: r.label, at } : acc;
  }, null);
  if (latest && latest.at > exportedAt) return { kind: "afterRecord", record: latest.label };

  const days = Math.floor((now.getTime() - exportedAt) / DAY_MS);
  if (days >= STALE_DAYS) return { kind: "stale", days };
  return { kind: "ok" };
}
