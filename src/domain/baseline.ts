// ベースラインの確定と改版（F07、CLAUDE.md 4章）。
// - v1 の確定は G1+2 承認と同じ操作（1つの関数）。承認＝その時点の計画を凍結する
// - 計画を変えるときは新しい版を作る（改版理由は必須）。改版のときに、その版から外すWPを理由付きで選べる
// - 確定できないのは、対象のWP（対象外とphaseを除く）に、未紐付け・見積が無いか0・計画日が無い・開始日が終了日より後・
//   期間内に営業日が無い、のいずれかがあるとき
// 状態を変える関数は、結果が validateState に通る状態だけを返す
import { appendAuditLog } from "./auditLog";
import { hasBusinessDay, localDate } from "./calendar";
import { operatorName, type OpResult } from "./proposal";
import { latestBaselineOf, type AppState, type Baseline, type BaselineItem, type WbsNode } from "./types";
import { isValidDate, LIMITS } from "./validate";
import { isUnlinked, targetWorkPackages } from "./wbs";

const ok = (state: AppState): OpResult => ({ ok: true, state });
const fail = (error: string): OpResult => ({ ok: false, error });
const tooLong = (...values: string[]) => values.some((v) => v.length > LIMITS.maxStringLength);

export const GATE_G12 = "G1+2";
export const GATE_REVISION = "改版";

/** 最新の版（版番号が最大のもの）。まだ確定していなければ null */
export const latestBaseline = (state: AppState): Baseline | null => latestBaselineOf(state.baselines);

export const itemsOf = (state: AppState, baselineId: string): BaselineItem[] =>
  state.baselineItems.filter((x) => x.baselineId === baselineId);

/** 版の計画工数の合計（BAC） */
export const bacOf = (state: AppState, baselineId: string): number =>
  Math.round(itemsOf(state, baselineId).reduce((sum, x) => sum + x.plannedHours, 0) * 100) / 100;

// ---------------------------------------------------------------- 確定できない理由

export interface WpBlocker {
  node: WbsNode;
  reasons: string[];
}

export interface Blockers {
  /** 案件全体の理由（対象のWPが無い、など） */
  general: string[];
  /** WPごとの理由 */
  workPackages: WpBlocker[];
}

export const hasBlockers = (b: Blockers) => b.general.length > 0 || b.workPackages.length > 0;

export function baselineBlockers(state: AppState): Blockers {
  const targets = targetWorkPackages(state);
  const general = targets.length === 0 ? ["確定の対象になるWPがありません（WPが無いか、すべて対象外です）。上のWBSで、テンプレートから展開するかWPを追加してください"] : [];
  const workPackages: WpBlocker[] = [];
  for (const node of targets) {
    const reasons: string[] = [];
    if (isUnlinked(state, node)) reasons.push("目的に紐付いていません");
    const hours = state.estimates.find((e) => e.wbsNodeId === node.id)?.hours;
    if (hours === undefined || hours <= 0) reasons.push("見積工数が無いか0です");
    if (node.plannedStart === null || node.plannedEnd === null) {
      reasons.push("計画開始日・計画終了日がありません");
    } else if (node.plannedStart > node.plannedEnd) {
      reasons.push("計画開始日が計画終了日より後です");
    } else if (!hasBusinessDay(node.plannedStart, node.plannedEnd, state.settings.holidays)) {
      reasons.push("計画の期間に営業日がありません");
    }
    if (reasons.length > 0) workPackages.push({ node, reasons });
  }
  return { general, workPackages };
}

// ---------------------------------------------------------------- 確定・改版

export interface ApprovalInput {
  /** 承認者（自己申告） */
  approver: string;
  /** 実際に合意した日（YYYY-MM-DD） */
  approvedOn: string;
  comment: string;
}

export interface Exclusion {
  wbsNodeId: string;
  reason: string;
}

export interface RevisionInput extends ApprovalInput {
  revisionReason: string;
  /** この版から外すWP（同じ操作で対象外にする） */
  exclusions: Exclusion[];
}

function checkApproval(state: AppState, input: ApprovalInput, now: Date): string | null {
  if (typeof input.approver !== "string" || input.approver.trim() === "") return "承認者を入力してください";
  if (typeof input.approvedOn !== "string" || !isValidDate(input.approvedOn)) return "合意日を入力してください";
  if (typeof input.comment !== "string" || tooLong(input.approver, input.comment)) return "文字数が多すぎます";
  if (input.approvedOn > localDate(now)) return "合意日に未来の日付は入れられません";
  const latest = latestBaseline(state);
  if (latest && input.approvedOn < latest.approvedOn) {
    return `合意日は、前の版（v${latest.version}）の合意日 ${latest.approvedOn} より前にできません`;
  }
  return null;
}

function blockerMessage(b: Blockers): string {
  const first = b.general[0] ?? (b.workPackages[0] ? `${b.workPackages[0].node.code} ${b.workPackages[0].node.name}：${b.workPackages[0].reasons.join("、")}` : "");
  const rest = b.general.length + b.workPackages.length - 1;
  return `ベースラインを確定できません（${first}${rest > 0 ? ` ほか${rest}件` : ""}）`;
}

/** 対象のWPを凍結した版と明細を作る */
function freeze(state: AppState, fields: Omit<Baseline, "id" | "version" | "approverSelfDeclared" | "operatedAt">, now: Date, newId: () => string) {
  const baseline: Baseline = {
    id: newId(),
    version: (latestBaseline(state)?.version ?? 0) + 1,
    approverSelfDeclared: true,
    operatedAt: now.toISOString(),
    ...fields,
  };
  const items: BaselineItem[] = targetWorkPackages(state).map((n) => ({
    id: newId(),
    baselineId: baseline.id,
    wbsNodeId: n.id,
    plannedHours: state.estimates.find((e) => e.wbsNodeId === n.id)?.hours ?? 0,
    plannedStart: n.plannedStart ?? "",
    plannedEnd: n.plannedEnd ?? "",
  }));
  return { baseline, items };
}

const summaryOf = (baseline: Baseline, items: BaselineItem[]) => ({
  version: baseline.version,
  approvedOn: baseline.approvedOn,
  approver: baseline.approver,
  itemCount: items.length,
  bac: Math.round(items.reduce((s, x) => s + x.plannedHours, 0) * 100) / 100,
});

/**
 * G1+2承認として、ベースラインv1を確定する。承認の記録・企画の承認・版と明細・監査ログを1つの操作で残す
 */
export function confirmBaseline(state: AppState, input: ApprovalInput, now: Date, newId: () => string): OpResult {
  if (state.baselines.length > 0) return fail("ベースラインv1は確定済みです。計画を変えるときは改版してください");
  const invalid = checkApproval(state, input, now);
  if (invalid) return fail(invalid);
  const blockers = baselineBlockers(state);
  if (hasBlockers(blockers)) return fail(blockerMessage(blockers));

  const { baseline, items } = freeze(state, { approvedOn: input.approvedOn, approver: input.approver, gate: GATE_G12, comment: input.comment, revisionReason: null }, now, newId);
  const reviewId = newId();
  let next: AppState = {
    ...state,
    proposal: { ...state.proposal, status: "approved", approvedOn: input.approvedOn },
    baselines: [...state.baselines, baseline],
    baselineItems: [...state.baselineItems, ...items],
    gateReviews: [
      ...state.gateReviews,
      {
        id: reviewId,
        decision: "approved",
        reviewedOn: input.approvedOn,
        reviewer: input.approver,
        reviewerSelfDeclared: true,
        comment: input.comment,
        baselineId: baseline.id,
        operatedAt: now.toISOString(),
      },
    ],
  };
  const operator = operatorName(state);
  next = appendAuditLog(
    next,
    { operator, targetType: "gateReview", targetId: reviewId, action: "gate.approve", before: { proposalStatus: state.proposal.status }, after: { reviewer: input.approver, reviewedOn: input.approvedOn, comment: input.comment, baselineId: baseline.id } },
    now,
    newId,
  );
  next = appendAuditLog(next, { operator, targetType: "baseline", targetId: baseline.id, action: "baseline.confirm", before: null, after: summaryOf(baseline, items) }, now, newId);
  return ok(next);
}

/** 改版で外すWPを対象外にした状態（確定できるかを、確定の前に画面で確かめるためにも使う） */
export function applyExclusions(state: AppState, exclusions: Exclusion[]): OpResult {
  const latest = latestBaseline(state);
  const inLatest = new Set(latest ? itemsOf(state, latest.id).map((x) => x.wbsNodeId) : []);
  const seen = new Set<string>();
  for (const x of exclusions) {
    if (typeof x !== "object" || x === null || typeof x.wbsNodeId !== "string") return fail("外すWPの指定が正しくありません");
    const node = state.wbsNodes.find((n) => n.id === x.wbsNodeId);
    if (!node) return fail("外すWPが見つかりません");
    if (node.kind !== "work_package") return fail(`${node.code} はWPではありません`);
    if (node.excluded) return fail(`${node.code} はすでに対象外です`);
    if (!inLatest.has(node.id)) return fail(`${node.code} は最新の版に含まれていません。版に含まれないWPは、計画画面で対象外にしてください`);
    if (seen.has(node.id)) return fail(`${node.code} が重複しています`);
    seen.add(node.id);
    if (typeof x.reason !== "string" || x.reason.trim() === "") return fail(`${node.code} ${node.name}を外す理由を入力してください`);
    if (x.reason.length > LIMITS.maxReasonLength) return fail(`外す理由は${LIMITS.maxReasonLength}文字以内にしてください`);
  }
  const reasonOf = new Map(exclusions.map((x) => [x.wbsNodeId, x.reason]));
  return ok({
    ...state,
    wbsNodes: state.wbsNodes.map((n) => (reasonOf.has(n.id) ? { ...n, excluded: true, excludedReason: reasonOf.get(n.id) ?? "" } : n)),
  });
}

/**
 * 改版：新しい版を確定する（計画を変えていなくてもよい。人間の判断）。改版理由は必須。外すWPは同じ操作で対象外にする
 */
export function reviseBaseline(state: AppState, input: RevisionInput, now: Date, newId: () => string): OpResult {
  const latest = latestBaseline(state);
  if (!latest) return fail("まだベースラインv1がありません。先にG1+2承認で確定してください");
  if (typeof input.revisionReason !== "string" || input.revisionReason.trim() === "") return fail("改版理由を入力してください");
  if (input.revisionReason.length > LIMITS.maxReasonLength) return fail(`改版理由は${LIMITS.maxReasonLength}文字以内にしてください`);
  if (!Array.isArray(input.exclusions)) return fail("外すWPの指定が正しくありません");
  const invalid = checkApproval(state, input, now);
  if (invalid) return fail(invalid);
  const excluded = applyExclusions(state, input.exclusions);
  if (!excluded.ok) return excluded;
  const planned = excluded.state;
  const blockers = baselineBlockers(planned);
  if (hasBlockers(blockers)) return fail(blockerMessage(blockers));

  const { baseline, items } = freeze(
    planned,
    { approvedOn: input.approvedOn, approver: input.approver, gate: GATE_REVISION, comment: input.comment, revisionReason: input.revisionReason },
    now,
    newId,
  );
  let next: AppState = { ...planned, baselines: [...planned.baselines, baseline], baselineItems: [...planned.baselineItems, ...items] };
  const nodeOf = (id: string) => state.wbsNodes.find((n) => n.id === id);
  const operator = operatorName(state);
  next = appendAuditLog(
    next,
    {
      operator,
      targetType: "baseline",
      targetId: baseline.id,
      action: "baseline.revise",
      before: summaryOf(latest, itemsOf(state, latest.id)),
      after: {
        ...summaryOf(baseline, items),
        revisionReason: input.revisionReason,
        excludedCodes: input.exclusions.map((x) => nodeOf(x.wbsNodeId)?.code ?? ""),
        comment: input.comment,
      },
    },
    now,
    newId,
  );
  // 外したWPは1件ずつ記録する（理由を監査ログに全文で残す。WPの対象外の理由は後から変えられるため）
  for (const x of input.exclusions) {
    const node = nodeOf(x.wbsNodeId);
    next = appendAuditLog(
      next,
      { operator, targetType: "wbsNode", targetId: x.wbsNodeId, action: "baseline.exclude", before: null, after: { baselineId: baseline.id, version: baseline.version, code: node?.code ?? "", name: node?.name ?? "", reason: x.reason } },
      now,
      newId,
    );
  }
  return ok(next);
}
