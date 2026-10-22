// 内部のコード値を画面に出すときの日本語ラベル（CLAUDE.md 7章：UIの文言は日本語）。画面ではここだけを使う
import type { Affiliation, GateDecision, ProposalStatus, Role, Route, SyncResult, WbsKind, WorkCategory } from "./domain/types";

export const ROUTE_LABELS: Record<Route, string> = { normal: "通常（G1→G2）", simple: "簡易（G1+2）" };
export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = { draft: "作成中", approved: "承認済み", returned: "差戻し" };
export const AFFILIATION_LABELS: Record<Affiliation, string> = { internal: "社内", vendor: "ベンダー" };
export const ROLE_LABELS: Record<Role, string> = {
  pm: "PM",
  member: "メンバー",
  supervisor: "監理者",
  viewer: "閲覧者",
  vendor: "ベンダー",
};
export const WBS_KIND_LABELS: Record<WbsKind, string> = { phase: "フェーズ", work_package: "WP（作業）" };
export const CATEGORY_LABELS: Record<WorkCategory, string> = {
  functional: "機能",
  non_functional_security: "非機能・セキュリティ",
  operation_transition: "運用・移行",
};
export const SYNC_RESULT_LABELS: Record<SyncResult, string> = { success: "成功", failure: "失敗" };
export const GATE_DECISION_LABELS: Record<GateDecision, string> = { approved: "承認", returned: "差戻し" };

/** 日時（ISO）を利用者の端末の時刻で表示する */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
