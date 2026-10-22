// 計画画面の操作（F03 WBS、F02 目的の紐付け、F04 見積。CLAUDE.md 3.1・7.2）。
// 状態を変える関数は、結果が validateState に通る状態だけを返す。4章のルールに反する操作は理由（日本語）を返す
import type { OpResult } from "./proposal";
import type { AppState, EstimationStandard, RequiredWpKey, WbsNode, WorkCategory } from "./types";
import { isValidDate, LIMITS } from "./validate";

const ok = (state: AppState): OpResult => ({ ok: true, state });
const fail = (error: string): OpResult => ({ ok: false, error });
const tooLong = (...values: string[]) => values.some((v) => v.length > LIMITS.maxStringLength);

// ---------------------------------------------------------------- テンプレート

interface TemplateWp {
  name: string;
  category: WorkCategory;
  requiredKey?: RequiredWpKey;
}

interface TemplatePhase {
  name: string;
  category: WorkCategory;
  wps: TemplateWp[];
}

/** WBSテンプレート（社内の標準WP構成。版1）。必須WP（3.3）を含む */
export const WBS_TEMPLATE: { version: string; phases: TemplatePhase[] } = {
  version: "1",
  phases: [
    {
      name: "企画・要件",
      category: "functional",
      wps: [
        { name: "企画・目的の整理", category: "functional" },
        { name: "要件定義", category: "functional" },
      ],
    },
    {
      name: "設計・開発",
      category: "functional",
      wps: [
        { name: "設計", category: "functional" },
        { name: "開発", category: "functional" },
        { name: "テスト", category: "functional" },
      ],
    },
    {
      name: "非機能・セキュリティ",
      category: "non_functional_security",
      wps: [
        { name: "非機能要件の定義", category: "non_functional_security", requiredKey: "nfr_definition" },
        { name: "脅威分析", category: "non_functional_security", requiredKey: "threat_analysis" },
        { name: "セキュリティテスト", category: "non_functional_security", requiredKey: "security_test" },
      ],
    },
    {
      name: "運用・移行",
      category: "operation_transition",
      wps: [
        { name: "運用設計", category: "operation_transition", requiredKey: "operation_design" },
        { name: "移行・リハーサル", category: "operation_transition", requiredKey: "migration_rehearsal" },
        { name: "運用引継ぎ", category: "operation_transition", requiredKey: "operation_handover" },
      ],
    },
  ],
};

/** PoCで最初に使う見積基準。値は仮（CLAUDE.md 4章：「仮」と明記して始める） */
export const PROVISIONAL_STANDARDS: Omit<EstimationStandard, "id">[] = [
  { workType: "PRのレビューと受け入れ", sizeUnit: "PR", hoursPerUnit: 1, version: "仮1", provisional: true },
  { workType: "文書の作成", sizeUnit: "文書", hoursPerUnit: 1, version: "仮1", provisional: true },
  { workType: "打合せ・確認", sizeUnit: "回", hoursPerUnit: 0.5, version: "仮1", provisional: true },
];

const blankNode = (fields: Pick<WbsNode, "id" | "code" | "name" | "kind" | "category" | "parentId"> & Partial<WbsNode>): WbsNode => ({
  asanaTaskGid: null,
  plannedStart: null,
  plannedEnd: null,
  completedOn: null,
  excluded: false,
  excludedReason: "",
  requiredKey: null,
  ...fields,
});

/**
 * テンプレートからWBSを展開する。WBSが空のときだけ（既存のWBSを上書き・重複させないため）。
 * 見積基準が無ければ、仮の見積基準も入れる
 */
export function expandTemplate(state: AppState, newId: () => string): OpResult {
  if (state.wbsNodes.length > 0) return fail("WBSがすでにあるため、テンプレートから展開できません。WPは個別に追加してください");
  const nodes: WbsNode[] = [];
  WBS_TEMPLATE.phases.forEach((phase, i) => {
    const phaseId = newId();
    nodes.push(blankNode({ id: phaseId, code: `${i + 1}`, name: phase.name, kind: "phase", category: phase.category, parentId: null }));
    phase.wps.forEach((wp, j) => {
      nodes.push(
        blankNode({
          id: newId(),
          code: `${i + 1}.${j + 1}`,
          name: wp.name,
          kind: "work_package",
          category: wp.category,
          parentId: phaseId,
          requiredKey: wp.requiredKey ?? null,
        }),
      );
    });
  });
  const standards =
    state.estimationStandards.length > 0 ? state.estimationStandards : PROVISIONAL_STANDARDS.map((s) => ({ ...s, id: newId() }));
  return ok({ ...state, wbsNodes: nodes, estimationStandards: standards });
}

// ---------------------------------------------------------------- 要素の追加・編集・削除

const isWp = (n: WbsNode) => n.kind === "work_package";

/** 次のコード。親の下の既存のコードの最大の番号の次（削除で欠番があっても重複させない） */
function nextCode(state: AppState, parentId: string | null): string {
  const parent = parentId === null ? null : state.wbsNodes.find((n) => n.id === parentId);
  const prefix = parent ? `${parent.code}.` : "";
  const nums = state.wbsNodes
    .filter((n) => n.parentId === parentId)
    .map((n) => Number(n.code.startsWith(prefix) ? n.code.slice(prefix.length) : NaN))
    .filter((x) => Number.isInteger(x));
  let code = `${prefix}${Math.max(0, ...nums) + 1}`;
  // 手で付けたコードと重なる場合に備え、空いている番号まで進める
  for (let k = Math.max(0, ...nums) + 2; state.wbsNodes.some((n) => n.code === code); k++) code = `${prefix}${k}`;
  return code;
}

export function addPhase(state: AppState, newId: () => string): OpResult {
  const node = blankNode({ id: newId(), code: nextCode(state, null), name: "", kind: "phase", category: "functional", parentId: null });
  return ok({ ...state, wbsNodes: [...state.wbsNodes, node] });
}

export function addWorkPackage(state: AppState, parentId: string, newId: () => string): OpResult {
  const parent = state.wbsNodes.find((n) => n.id === parentId);
  if (!parent || parent.kind !== "phase") return fail("WPはフェーズの下に追加してください");
  const node = blankNode({ id: newId(), code: nextCode(state, parentId), name: "", kind: "work_package", category: parent.category, parentId });
  return ok({ ...state, wbsNodes: [...state.wbsNodes, node] });
}

export type NodePatch = Partial<Pick<WbsNode, "code" | "name" | "category" | "plannedStart" | "plannedEnd">>;

const CATEGORIES: readonly WorkCategory[] = ["functional", "non_functional_security", "operation_transition"];

export function updateNode(state: AppState, id: string, rawPatch: NodePatch): OpResult {
  const node = state.wbsNodes.find((n) => n.id === id);
  if (!node) return fail("WBS要素が見つかりません");
  const patch = Object.fromEntries(Object.entries(rawPatch).filter(([, v]) => v !== undefined)) as NodePatch;
  if (patch.code !== undefined) {
    if (typeof patch.code !== "string" || patch.code.trim() === "") return fail("WBSコードを入力してください");
    if (state.wbsNodes.some((n) => n.id !== id && n.code === patch.code)) return fail(`WBSコード「${patch.code}」はすでに使われています`);
  }
  if (patch.name !== undefined && typeof patch.name !== "string") return fail("作業名の値が正しくありません");
  if (tooLong(patch.code ?? "", patch.name ?? "")) return fail("文字数が多すぎます");
  if (patch.category !== undefined && !CATEGORIES.includes(patch.category)) return fail("作業区分の値が正しくありません");
  if (node.requiredKey !== null && patch.category !== undefined && patch.category !== node.category) {
    return fail("必須WPの作業区分は変えられません");
  }
  for (const k of ["plannedStart", "plannedEnd"] as const) {
    const v = patch[k];
    if (v !== undefined && v !== null && !isValidDate(v)) return fail("日付の形式が正しくありません");
  }
  const start = patch.plannedStart !== undefined ? patch.plannedStart : node.plannedStart;
  const end = patch.plannedEnd !== undefined ? patch.plannedEnd : node.plannedEnd;
  if (start && end && start > end) return fail("計画開始日が計画終了日より後になっています");
  if (!isWp(node) && (patch.plannedStart !== undefined || patch.plannedEnd !== undefined)) return fail("計画日はWPに入力してください");
  return ok({ ...state, wbsNodes: state.wbsNodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) });
}

/** WPを対象外にする／戻す（本番リリースの無い案件など）。対象外にするには理由が要る */
export function setExcluded(state: AppState, id: string, excluded: boolean, reason: string): OpResult {
  const node = state.wbsNodes.find((n) => n.id === id);
  if (!node || !isWp(node)) return fail("WPが見つかりません");
  if (excluded && reason.trim() === "") return fail("対象外にする理由を入力してください");
  if (tooLong(reason)) return fail("文字数が多すぎます");
  return ok({
    ...state,
    wbsNodes: state.wbsNodes.map((n) => (n.id === id ? { ...n, excluded, excludedReason: excluded ? reason : "" } : n)),
  });
}

/** 要素とその子孫（訪問済みの集合で辿る） */
export function descendantsOf(state: AppState, id: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length > 0) {
    const cur = stack.pop() as string;
    if (seen.has(cur)) continue;
    seen.add(cur);
    out.push(cur);
    for (const n of state.wbsNodes) if (n.parentId === cur) stack.push(n.id);
  }
  return out;
}

export interface RemovalImpact {
  nodes: number;
  estimates: number;
  traces: number;
  /** 削除できない理由。削除できるなら null */
  blocker: string | null;
}

/** 削除したときに一緒に消えるもの（削除の確認で見せる）と、削除できない理由 */
export function removalImpact(state: AppState, id: string): RemovalImpact {
  const ids = new Set(descendantsOf(state, id));
  const nodes = state.wbsNodes.filter((n) => ids.has(n.id));
  let blocker: string | null = null;
  if (nodes.some((n) => n.requiredKey !== null)) {
    blocker = "テンプレートの必須WPを含むため削除できません（不要なら「対象外」にして理由を残してください）";
  } else if (state.baselineItems.some((b) => ids.has(b.wbsNodeId))) {
    blocker = "確定済みのベースラインに含まれるため削除できません";
  } else if (state.timeEntries.some((t) => ids.has(t.wbsNodeId))) {
    blocker = "実績工数が登録されているため削除できません";
  }
  return {
    nodes: nodes.length,
    estimates: state.estimates.filter((e) => ids.has(e.wbsNodeId)).length,
    traces: state.objectiveTraces.filter((t) => ids.has(t.wbsNodeId)).length,
    blocker,
  };
}

export function removeNode(state: AppState, id: string): OpResult {
  if (!state.wbsNodes.some((n) => n.id === id)) return fail("WBS要素が見つかりません");
  const impact = removalImpact(state, id);
  if (impact.blocker) return fail(impact.blocker);
  const ids = new Set(descendantsOf(state, id));
  return ok({
    ...state,
    wbsNodes: state.wbsNodes.filter((n) => !ids.has(n.id)),
    estimates: state.estimates.filter((e) => !ids.has(e.wbsNodeId)),
    objectiveTraces: state.objectiveTraces.filter((t) => !ids.has(t.wbsNodeId)),
  });
}

// ---------------------------------------------------------------- 目的の紐付け（F02）

/** WPを目的に紐付ける／外す。紐付けには「貢献の内容」を添えられる */
export function setTrace(state: AppState, wbsNodeId: string, objectiveId: string, linked: boolean, newId: () => string): OpResult {
  const node = state.wbsNodes.find((n) => n.id === wbsNodeId);
  if (!node || !isWp(node)) return fail("WPが見つかりません");
  if (!state.objectives.some((o) => o.id === objectiveId)) return fail("目的が見つかりません");
  const existing = state.objectiveTraces.find((t) => t.wbsNodeId === wbsNodeId && t.objectiveId === objectiveId);
  if (linked && !existing) {
    return ok({ ...state, objectiveTraces: [...state.objectiveTraces, { id: newId(), objectiveId, wbsNodeId, contribution: "" }] });
  }
  if (!linked && existing) return ok({ ...state, objectiveTraces: state.objectiveTraces.filter((t) => t.id !== existing.id) });
  return ok(state);
}

export function updateContribution(state: AppState, traceId: string, contribution: string): OpResult {
  if (!state.objectiveTraces.some((t) => t.id === traceId)) return fail("紐付けが見つかりません");
  if (typeof contribution !== "string" || tooLong(contribution)) return fail("文字数が多すぎます");
  return ok({ ...state, objectiveTraces: state.objectiveTraces.map((t) => (t.id === traceId ? { ...t, contribution } : t)) });
}

// ---------------------------------------------------------------- 見積（F04）

export interface EstimateInput {
  hours: number | null;
  basis: string;
}

/** 見積工数と見積根拠を手で入れる（見積基準の適用は外れる）。工数を空にすると見積を消す */
export function setEstimate(state: AppState, wbsNodeId: string, input: EstimateInput, newId: () => string): OpResult {
  const node = state.wbsNodes.find((n) => n.id === wbsNodeId);
  if (!node || !isWp(node)) return fail("見積はWPに入力してください");
  if (typeof input.basis !== "string" || tooLong(input.basis)) return fail("文字数が多すぎます");
  const existing = state.estimates.find((e) => e.wbsNodeId === wbsNodeId);
  if (input.hours === null) {
    if (!existing) return ok(state);
    if (input.basis.trim() !== "") return ok({ ...state, estimates: state.estimates.map((e) => (e.id === existing.id ? { ...e, hours: 0, basis: input.basis } : e)) });
    return ok({ ...state, estimates: state.estimates.filter((e) => e.id !== existing.id) });
  }
  if (!Number.isFinite(input.hours) || input.hours < 0 || input.hours > LIMITS.maxHours) {
    return fail(`見積工数は0〜${LIMITS.maxHours}時間の数値で入力してください`);
  }
  const hours = input.hours;
  if (existing) {
    const changed = existing.hours !== hours;
    return ok({
      ...state,
      estimates: state.estimates.map((e) =>
        e.id === existing.id ? { ...e, hours, basis: input.basis, standardId: changed ? null : e.standardId } : e,
      ),
    });
  }
  return ok({ ...state, estimates: [...state.estimates, { id: newId(), wbsNodeId, hours, basis: input.basis, standardId: null }] });
}

/** 見積基準を適用する：工数 ＝ 単位あたり工数 × 数量。見積根拠に基準と数量を残す */
export function applyStandard(state: AppState, wbsNodeId: string, standardId: string, quantity: number, newId: () => string): OpResult {
  const standard = state.estimationStandards.find((s) => s.id === standardId);
  if (!standard) return fail("見積基準が見つかりません");
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 10_000) return fail("数量は0より大きい数値で入力してください");
  const hours = Math.round(standard.hoursPerUnit * quantity * 100) / 100;
  const basis = `見積基準「${standard.workType}」${standard.provisional ? "（仮）" : ""} ${standard.hoursPerUnit}時間/${standard.sizeUnit} × ${quantity}${standard.sizeUnit}`;
  const r = setEstimate(state, wbsNodeId, { hours, basis }, newId);
  if (!r.ok) return r;
  return ok({ ...r.state, estimates: r.state.estimates.map((e) => (e.wbsNodeId === wbsNodeId ? { ...e, standardId } : e)) });
}

// ---------------------------------------------------------------- 集計（7.2）

/** 確定・判定の対象になるWP（対象外とphaseを除く） */
export const targetWorkPackages = (state: AppState) => state.wbsNodes.filter((n) => isWp(n) && !n.excluded);

export function isUnlinked(state: AppState, node: WbsNode): boolean {
  return isWp(node) && !node.excluded && !state.objectiveTraces.some((t) => t.wbsNodeId === node.id);
}

export interface PlanSummary {
  totalHours: number;
  standardAppliedCount: number;
  unlinkedCount: number;
  excludedCount: number;
  targetCount: number;
}

export function planSummary(state: AppState): PlanSummary {
  const targets = targetWorkPackages(state);
  const targetIds = new Set(targets.map((n) => n.id));
  const estimates = state.estimates.filter((e) => targetIds.has(e.wbsNodeId));
  return {
    totalHours: Math.round(estimates.reduce((sum, e) => sum + e.hours, 0) * 100) / 100,
    standardAppliedCount: estimates.filter((e) => e.standardId !== null).length,
    unlinkedCount: targets.filter((n) => isUnlinked(state, n)).length,
    excludedCount: state.wbsNodes.filter((n) => isWp(n) && n.excluded).length,
    targetCount: targets.length,
  };
}

/** 表示順：WBSコードを数字の区切りごとに比べて並べる（"1.10" を "1.9" の後にする） */
export function compareCodes(a: string, b: string): number {
  const pa = a.split(".");
  const pb = b.split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === undefined) return -1;
    if (pb[i] === undefined) return 1;
    const na = Number(pa[i]);
    const nb = Number(pb[i]);
    const d = Number.isFinite(na) && Number.isFinite(nb) ? na - nb : pa[i].localeCompare(pb[i]);
    if (d !== 0) return d;
  }
  return 0;
}
