// 実績工数の個人別表示の権限（CLAUDE.md 4章：本人とPMのみ。実績工数はプロジェクト管理にのみ使い、人事評価には使わない）。
// PoCでは利用者が1名（PM）のため、閲覧者はPM（自己申告）に固定し、判定の処理を通す形だけ作る
import type { AppState, Role } from "./types";

/** 閲覧者：体制でPMとして登録したメンバー（認証が無いため自己申告。未設定なら null） */
export function currentViewer(state: AppState): string | null {
  return state.project.pmMemberId;
}

/**
 * 閲覧者が、あるメンバーの実績工数を個人別に見られるか。本人かPMなら見られる。
 * 閲覧者が分からない（PM未設定）ときは見られない。メンバーの無い実績（memberId が null）はPMだけが見られる
 */
export function canViewPersonalActuals(state: AppState, viewerMemberId: string | null, targetMemberId: string | null): boolean {
  if (viewerMemberId === null || !state.members.some((m) => m.id === viewerMemberId)) return false;
  if (viewerMemberId === state.project.pmMemberId) return true;
  return targetMemberId !== null && viewerMemberId === targetMemberId;
}

export interface PersonalActualsRow {
  memberId: string | null;
  name: string;
  role: Role | null;
  hours: number;
}

/**
 * 基準日までの実績工数のメンバー別の合計（権限の判定を通したものだけ）。
 * 見られないメンバーは、人数も分からないよう、何も返さない
 */
export function personalActuals(state: AppState, viewerMemberId: string | null, asOf: string): PersonalActualsRow[] {
  const minutesOf = new Map<string | null, number>();
  for (const t of state.timeEntries) {
    if (t.workDate <= asOf) minutesOf.set(t.memberId, (minutesOf.get(t.memberId) ?? 0) + t.minutes);
  }
  const rows: PersonalActualsRow[] = [];
  for (const [memberId, minutes] of minutesOf) {
    if (!canViewPersonalActuals(state, viewerMemberId, memberId)) continue;
    const member = state.members.find((m) => m.id === memberId);
    const role = state.projectMembers.find((p) => p.memberId === memberId)?.role ?? null;
    rows.push({ memberId, name: member ? member.name || "（氏名が未入力）" : "（メンバーなし）", role, hours: minutes / 60 });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name, "ja"));
  return rows;
}
