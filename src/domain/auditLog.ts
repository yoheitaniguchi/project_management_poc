// 監査ログ（CLAUDE.md 4章：追記のみ）。既存のログは変えず、末尾に1件足した新しい一覧を返す。
import type { AppState, AuditLog } from "./types";
import { LIMITS, timeOf } from "./validate";

export interface AuditEntryInput {
  operator: string;
  targetType: string;
  targetId: string;
  action: string;
  before: unknown;
  after: unknown;
}

const OMITTED = "…（長いため省略）";

/** 変更前後の値をJSONにする。上限を超える分は切り詰め、保存したものを必ず読み戻せるようにする */
const toJson = (v: unknown): string | null => {
  if (v === undefined || v === null) return null;
  const json = JSON.stringify(v);
  return json.length <= LIMITS.maxAuditPayloadLength
    ? json
    : json.slice(0, LIMITS.maxAuditPayloadLength - OMITTED.length) + OMITTED;
};

export function appendAuditLog(state: AppState, input: AuditEntryInput, now: Date, newId: () => string): AppState {
  const last = state.auditLogs[state.auditLogs.length - 1];
  const at = now.toISOString();
  // 端末の時計が戻っても、日時が前のログより前にならないようにする（validate.ts の検査と揃える）
  const safeAt = last && timeOf(last.at) > timeOf(at) ? last.at : at;
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
