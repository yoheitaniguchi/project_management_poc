// WPの完了の手動設定（CLAUDE.md 5章の一時変更：AsanaのCSV取込を入れるまでの間、完了は画面で手動で設定し、
// 完了日を記録する。完了の取り消しもでき、どちらも AuditLog に記録する）
import { appendAuditLog } from "./auditLog";
import { localDate } from "./calendar";
import { operatorName, type OpResult } from "./proposal";
import type { AppState } from "./types";
import { isPlanDate } from "./validate";

const ok = (state: AppState): OpResult => ({ ok: true, state });
const fail = (error: string): OpResult => ({ ok: false, error });

/** WPを完了にする（完了日を変えるときも同じ操作）。完了日は今日以前 */
export function setCompleted(state: AppState, wbsNodeId: string, completedOn: string, now: Date, newId: () => string): OpResult {
  const node = state.wbsNodes.find((n) => n.id === wbsNodeId);
  if (!node || node.kind !== "work_package") return fail("WPが見つかりません");
  if (node.excluded) return fail("対象外のWPは完了にできません");
  if (typeof completedOn !== "string" || !isPlanDate(completedOn)) return fail("完了日を入力してください");
  if (completedOn > localDate(now)) return fail("完了日に未来の日付は入れられません");
  if (node.completedOn === completedOn) return ok(state);
  const next: AppState = { ...state, wbsNodes: state.wbsNodes.map((n) => (n.id === wbsNodeId ? { ...n, completedOn } : n)) };
  return ok(
    appendAuditLog(
      next,
      {
        operator: operatorName(state),
        targetType: "wbsNode",
        targetId: wbsNodeId,
        action: "wbs.complete",
        before: { completedOn: node.completedOn },
        after: { code: node.code, name: node.name, completedOn },
      },
      now,
      newId,
    ),
  );
}

/** WPの完了を取り消す */
export function clearCompleted(state: AppState, wbsNodeId: string, now: Date, newId: () => string): OpResult {
  const node = state.wbsNodes.find((n) => n.id === wbsNodeId);
  if (!node || node.kind !== "work_package") return fail("WPが見つかりません");
  if (node.completedOn === null) return fail("このWPは完了になっていません");
  const next: AppState = { ...state, wbsNodes: state.wbsNodes.map((n) => (n.id === wbsNodeId ? { ...n, completedOn: null } : n)) };
  return ok(
    appendAuditLog(
      next,
      {
        operator: operatorName(state),
        targetType: "wbsNode",
        targetId: wbsNodeId,
        action: "wbs.uncomplete",
        before: { code: node.code, name: node.name, completedOn: node.completedOn },
        after: { completedOn: null },
      },
      now,
      newId,
    ),
  );
}
