// 企画・目的画面の操作（F01、CLAUDE.md 7.1）。状態を変える関数は、結果が validateState に通る状態だけを返す。
// 4章のルールに反する操作は、状態を変えずに理由（日本語）を返す。
import { appendAuditLog } from "./auditLog";
import type { Affiliation, AppState, Member, Objective, Project, Proposal, Role, Route } from "./types";
import { isValidDate, LIMITS } from "./validate";

export type OpResult = { ok: true; state: AppState } | { ok: false; error: string };

const ok = (state: AppState): OpResult => ({ ok: true, state });
const fail = (error: string): OpResult => ({ ok: false, error });

/** 監査ログの操作者。認証が無いので、PMとして登録したメンバーの名前を使う（自己申告） */
export function operatorName(state: AppState): string {
  const pm = state.members.find((m) => m.id === state.project.pmMemberId);
  return pm?.name.trim() || "（PM未設定）";
}

const tooLong = (...values: string[]) => values.some((v) => v.length > LIMITS.maxStringLength);

/** 値が undefined の項目を取り除く（型をすり抜けた undefined で、検証に通らない状態を作らないため） */
function defined<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>;
}

const strings = (patch: object) => Object.values(patch).filter((v): v is string => typeof v === "string");
const notString = (patch: object) => Object.values(patch).some((v) => typeof v !== "string");

const ROUTES: readonly Route[] = ["normal", "simple"];
const AFFILIATIONS: readonly Affiliation[] = ["internal", "vendor"];
const ROLES: readonly Role[] = ["pm", "member", "supervisor", "viewer", "vendor"];

/** 権限の変更の監査ログに残す、そのメンバーの情報（誰の権限かが監査ログだけで分かるように） */
function memberSnapshot(state: AppState, memberId: string, role: Role | null) {
  return { memberId, name: state.members.find((m) => m.id === memberId)?.name ?? "", role };
}

// ---------------------------------------------------------------- 企画・プロジェクト

export type ProposalPatch = Partial<Pick<Proposal, "background" | "issues" | "estimatedHours">>;

export function updateProposal(state: AppState, rawPatch: ProposalPatch): OpResult {
  const patch = defined(rawPatch);
  if (tooLong(...strings(patch))) return fail("文字数が多すぎます");
  if (patch.estimatedHours !== undefined && patch.estimatedHours !== null) {
    const h = patch.estimatedHours;
    if (!Number.isFinite(h) || h < 0 || h > LIMITS.maxHours * 10) {
      return fail(`想定工数は0〜${LIMITS.maxHours * 10}時間の数値で入力してください`);
    }
  }
  if (patch.background !== undefined && typeof patch.background !== "string") return fail("背景の値が正しくありません");
  if (patch.issues !== undefined && typeof patch.issues !== "string") return fail("課題の値が正しくありません");
  return ok({ ...state, proposal: { ...state.proposal, ...patch } });
}

export type ProjectPatch = Partial<Pick<Project, "name" | "scope" | "route" | "hasRelease">>;

export function updateProject(state: AppState, rawPatch: ProjectPatch): OpResult {
  const patch = defined(rawPatch);
  if (tooLong(...strings(patch))) return fail("文字数が多すぎます");
  if (patch.route !== undefined && !ROUTES.includes(patch.route)) return fail("ルートの値が正しくありません");
  if (patch.hasRelease !== undefined && typeof patch.hasRelease !== "boolean") return fail("リリースの有無の値が正しくありません");
  if ((patch.name !== undefined && typeof patch.name !== "string") || (patch.scope !== undefined && typeof patch.scope !== "string")) {
    return fail("値が正しくありません");
  }
  return ok({ ...state, project: { ...state.project, ...patch } });
}

// ---------------------------------------------------------------- 目的・成功指標

/** 次の目的コード（O1, O2, …）。削除で欠番があっても、既存の最大の番号の次にする */
function nextObjectiveCode(objectives: Objective[]): string {
  const nums = objectives.map((o) => Number(/^O(\d+)$/.exec(o.code)?.[1] ?? 0));
  return `O${Math.max(0, ...nums) + 1}`;
}

export function addObjective(state: AppState, newId: () => string): OpResult {
  const objective: Objective = {
    id: newId(),
    code: nextObjectiveCode(state.objectives),
    content: "",
    metricName: "",
    targetValue: "",
    measurementTiming: "",
  };
  return ok({ ...state, objectives: [...state.objectives, objective] });
}

export type ObjectivePatch = Partial<Omit<Objective, "id" | "code">>;

export function updateObjective(state: AppState, id: string, rawPatch: ObjectivePatch): OpResult {
  if (!state.objectives.some((o) => o.id === id)) return fail("目的が見つかりません");
  const patch = defined(rawPatch);
  if (notString(patch)) return fail("値が正しくありません");
  if (tooLong(...strings(patch))) return fail("文字数が多すぎます");
  return ok({ ...state, objectives: state.objectives.map((o) => (o.id === id ? { ...o, ...patch } : o)) });
}

/** 目的を削除したときに未紐付けに戻るWPの数（削除の確認で見せる） */
export function tracesOfObjective(state: AppState, id: string): number {
  return state.objectiveTraces.filter((t) => t.objectiveId === id).length;
}

/**
 * 目的を削除する。紐付けも一緒に消す（紐付いていたWPは未紐付けに戻る）。
 * G1+2で合意した目的を後から消すこともあるため、監査ログに残す
 */
export function removeObjective(state: AppState, id: string, now: Date, newId: () => string): OpResult {
  const objective = state.objectives.find((o) => o.id === id);
  if (!objective) return fail("目的が見つかりません");
  const next: AppState = {
    ...state,
    objectives: state.objectives.filter((o) => o.id !== id),
    objectiveTraces: state.objectiveTraces.filter((t) => t.objectiveId !== id),
  };
  return ok(
    appendAuditLog(
      next,
      {
        operator: operatorName(state),
        targetType: "objective",
        targetId: id,
        action: "objective.remove",
        before: { code: objective.code, content: objective.content, tracedWorkPackages: tracesOfObjective(state, id) },
        after: null,
      },
      now,
      newId,
    ),
  );
}

// ---------------------------------------------------------------- 体制（メンバーと役割）

/** メンバーを体制に加える。役割の付与も権限の変更として監査ログに残す */
export function addMember(state: AppState, role: Role, now: Date, newId: () => string): OpResult {
  if (!ROLES.includes(role)) return fail("役割の値が正しくありません");
  if (role === "pm" && state.projectMembers.some((p) => p.role === "pm")) {
    return fail("PMは1名だけです。先に今のPMの役割を変えてください");
  }
  const member: Member = { id: newId(), name: "", affiliation: "internal", asanaUserGid: null };
  const projectMemberId = newId();
  const next: AppState = {
    ...state,
    members: [...state.members, member],
    projectMembers: [...state.projectMembers, { id: projectMemberId, memberId: member.id, role }],
    project: { ...state.project, pmMemberId: role === "pm" ? member.id : state.project.pmMemberId },
  };
  return ok(
    appendAuditLog(
      next,
      { operator: operatorName(state), targetType: "projectMember", targetId: projectMemberId, action: "role.assign", before: null, after: { memberId: member.id, name: "", role } },
      now,
      newId,
    ),
  );
}

export type MemberPatch = Partial<Pick<Member, "name" | "affiliation">>;

export function updateMember(state: AppState, id: string, rawPatch: MemberPatch): OpResult {
  if (!state.members.some((m) => m.id === id)) return fail("メンバーが見つかりません");
  const patch = defined(rawPatch);
  if (patch.name !== undefined && typeof patch.name !== "string") return fail("氏名の値が正しくありません");
  if (patch.affiliation !== undefined && !AFFILIATIONS.includes(patch.affiliation)) return fail("所属の値が正しくありません");
  if (tooLong(patch.name ?? "")) return fail("文字数が多すぎます");
  return ok({ ...state, members: state.members.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
}

/**
 * 役割を変える。権限の変更なので監査ログに残す（CLAUDE.md 4章）。
 * PMの役割を付けたメンバーをプロジェクトのPMにし、外したらPMを空にする
 */
export function changeRole(state: AppState, memberId: string, role: Role, now: Date, newId: () => string): OpResult {
  if (!ROLES.includes(role)) return fail("役割の値が正しくありません");
  const pm = state.projectMembers.find((p) => p.memberId === memberId);
  if (!pm) return fail("メンバーが見つかりません");
  if (pm.role === role) return ok(state);
  if (role === "pm" && state.projectMembers.some((p) => p.role === "pm" && p.memberId !== memberId)) {
    return fail("PMは1名だけです。先に今のPMの役割を変えてください");
  }
  const next: AppState = {
    ...state,
    projectMembers: state.projectMembers.map((p) => (p.memberId === memberId ? { ...p, role } : p)),
    project: {
      ...state.project,
      pmMemberId: role === "pm" ? memberId : state.project.pmMemberId === memberId ? null : state.project.pmMemberId,
    },
  };
  return ok(
    appendAuditLog(
      next,
      {
        operator: operatorName(state),
        targetType: "projectMember",
        targetId: pm.id,
        action: "role.change",
        before: memberSnapshot(state, memberId, pm.role),
        after: memberSnapshot(state, memberId, role),
      },
      now,
      newId,
    ),
  );
}

/** メンバーを削除できない理由（削除ボタンを無効にして見せる）。削除できるなら null */
export function memberRemovalBlocker(state: AppState, memberId: string): string | null {
  if (state.timeEntries.some((t) => t.memberId === memberId)) return "実績工数が登録されているため削除できません";
  return null;
}

export function removeMember(state: AppState, memberId: string, now: Date, newId: () => string): OpResult {
  const blocker = memberRemovalBlocker(state, memberId);
  if (blocker) return fail(blocker);
  const pm = state.projectMembers.find((p) => p.memberId === memberId);
  if (!pm) return fail("メンバーが見つかりません");
  const next: AppState = {
    ...state,
    members: state.members.filter((m) => m.id !== memberId),
    projectMembers: state.projectMembers.filter((p) => p.memberId !== memberId),
    project: { ...state.project, pmMemberId: state.project.pmMemberId === memberId ? null : state.project.pmMemberId },
  };
  // 体制から外すことも権限の変更として残す
  return ok(
    appendAuditLog(
      next,
      { operator: operatorName(state), targetType: "projectMember", targetId: pm.id, action: "role.remove", before: memberSnapshot(state, memberId, pm.role), after: null },
      now,
      newId,
    ),
  );
}

// ---------------------------------------------------------------- G1+2の差戻し

export interface ReturnInput {
  reviewer: string;
  reviewedOn: string;
  comment: string;
}

/**
 * G1+2の差戻しを記録する（CLAUDE.md 4章：差戻しは記録だけ残す）。
 * 承認はベースラインの確定と同じ操作で、計画画面で行う（baseline.ts の confirmBaseline）。
 * v1 の確定（承認）の後に記録した差戻しは、改版に向けた差戻しとして記録だけ残し、
 * 企画の承認の状態は変えない（承認＝v1の確定は取り消せないため）
 */
export function recordGateReturn(state: AppState, input: ReturnInput, now: Date, newId: () => string): OpResult {
  if (input.reviewer.trim() === "") return fail("承認者（差戻しをした人）を入力してください");
  if (!isValidDate(input.reviewedOn)) return fail("差戻しの日付を入力してください");
  if (input.comment.trim() === "") return fail("差戻しの理由をコメントに入力してください");
  if (tooLong(input.reviewer, input.comment)) return fail("文字数が多すぎます");
  const id = newId();
  const next: AppState = {
    ...state,
    proposal: { ...state.proposal, status: state.baselines.length === 0 ? "returned" : state.proposal.status },
    gateReviews: [
      ...state.gateReviews,
      {
        id,
        decision: "returned",
        reviewedOn: input.reviewedOn,
        reviewer: input.reviewer,
        reviewerSelfDeclared: true,
        comment: input.comment,
        baselineId: null,
        operatedAt: now.toISOString(),
      },
    ],
  };
  return ok(
    appendAuditLog(
      next,
      { operator: operatorName(state), targetType: "gateReview", targetId: id, action: "gate.return", before: null, after: { reviewer: input.reviewer, reviewedOn: input.reviewedOn, comment: input.comment } },
      now,
      newId,
    ),
  );
}
