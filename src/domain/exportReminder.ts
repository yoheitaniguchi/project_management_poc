// JSONの書き出しを促すかの判定（CLAUDE.md 6.1：毎週の書き出しが正式な記録）。画面から切り離した純粋な関数
import type { AppState } from "./types";
import { timeOf } from "./validate";

export type ExportReminder =
  | { kind: "ok" }
  /** 書き出すデータがまだ無い（初期状態） */
  | { kind: "nothingYet" }
  | { kind: "never" }
  | { kind: "stale"; days: number }
  /** ベースラインを確定・改版した後に書き出していない */
  | { kind: "afterBaseline"; version: number };

export const STALE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export function exportReminder(state: AppState, now: Date): ExportReminder {
  const hasData = state.objectives.length > 0 || state.wbsNodes.length > 0 || state.members.length > 0 || state.project.name !== "";
  if (state.lastExportedAt === null) return hasData ? { kind: "never" } : { kind: "nothingYet" };
  const exportedAt = timeOf(state.lastExportedAt);
  const latest = state.baselines.reduce<{ version: number; at: number } | null>((acc, b) => {
    const at = timeOf(b.operatedAt);
    return acc === null || at > acc.at ? { version: b.version, at } : acc;
  }, null);
  if (latest && latest.at > exportedAt) return { kind: "afterBaseline", version: latest.version };
  const days = Math.floor((now.getTime() - exportedAt) / DAY_MS);
  if (days >= STALE_DAYS) return { kind: "stale", days };
  return { kind: "ok" };
}
