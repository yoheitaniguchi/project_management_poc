// 監査ログ（CLAUDE.md 4章：追記のみ）。既存のログは変えず、末尾に1件足した新しい一覧を返す。
import type { AppState, AuditLog } from "./types";

export interface AuditEntryInput {
  operator: string;
  targetType: string;
  targetId: string;
  action: string;
  before: unknown;
  after: unknown;
}

const toJson = (v: unknown): string | null => (v === undefined || v === null ? null : JSON.stringify(v));

export function appendAuditLog(state: AppState, input: AuditEntryInput, now: Date, newId: () => string): AppState {
  const last = state.auditLogs[state.auditLogs.length - 1];
  const at = now.toISOString();
  // 端末の時計が戻っても、日時が前のログより前にならないようにする（validate.ts の検査と揃える）
  const safeAt = last && last.at > at ? last.at : at;
  const entry: AuditLog = {
    id: newId(),
    seq: (last?.seq ?? 0) + 1,
    at: safeAt,
    operator: input.operator,
    operatorSelfDeclared: true,
    targetType: input.targetType,
    targetId: input.targetId,
    action: input.action,
    before: toJson(input.before),
    after: toJson(input.after),
  };
  return { ...state, auditLogs: [...state.auditLogs, entry] };
}
