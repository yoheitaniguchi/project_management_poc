import { describe, expect, it } from "vitest";
import { addObjective } from "./proposal";
import type { OpResult } from "./proposal";
import { expectValidState, fixtureRaw } from "./testState";
import { createInitialState, REQUIRED_WP_KEYS, type AppState } from "./types";
import { validateState } from "./validate";
import {
  addPhase,
  addWorkPackage,
  applyStandard,
  compareCodes,
  expandTemplate,
  isUnlinked,
  planSummary,
  removalImpact,
  removeNode,
  seedProvisionalStandards,
  setEstimate,
  setExcluded,
  setTrace,
  updateContribution,
  updateNode,
} from "./wbs";

const ids = () => {
  let n = 0;
  return () => `id${++n}`;
};
const okState = (r: OpResult): AppState => {
  if (!r.ok) throw new Error(r.error);
  expectValidState(r.state);
  return r.state;
};
const expanded = () => {
  const id = ids();
  let s = okState(addObjective(createInitialState(), id));
  s = okState(expandTemplate(s, id));
  return { s, id };
};
const wpByName = (s: AppState, name: string) => {
  const n = s.wbsNodes.find((x) => x.name === name);
  if (!n) throw new Error(name);
  return n;
};

describe("テンプレートからの展開（F03）", () => {
  it("必須WP6件（3.3）をすべて含み、作業区分が付く。仮の見積基準も入る", () => {
    const { s } = expanded();
    const required = s.wbsNodes.filter((n) => n.requiredKey !== null);
    expect(required.map((n) => n.requiredKey).sort()).toEqual([...REQUIRED_WP_KEYS].sort());
    expect(wpByName(s, "脅威分析").category).toBe("non_functional_security");
    expect(wpByName(s, "運用引継ぎ").category).toBe("operation_transition");
    expect(s.estimationStandards.length).toBeGreaterThan(0);
    expect(s.estimationStandards.every((x) => x.provisional)).toBe(true);
    expect(s.wbsNodes.map((n) => n.code)).toContain("3.2");
  });

  it("WBSがあるときは展開しない（上書き・重複を防ぐ）", () => {
    const { s, id } = expanded();
    expect(expandTemplate(s, id).ok).toBe(false);
  });
});

describe("要素の追加・編集・削除", () => {
  it("フェーズとWPを追加すると、重ならないコードが振られる", () => {
    const { s: s0, id } = expanded();
    let s = okState(addPhase(s0, id));
    const phase = s.wbsNodes.at(-1);
    expect(phase?.code).toBe("5");
    s = okState(addWorkPackage(s, phase?.id ?? "", id));
    s = okState(addWorkPackage(s, phase?.id ?? "", id));
    expect(s.wbsNodes.slice(-2).map((n) => n.code)).toEqual(["5.1", "5.2"]);
  });

  it("WPの下にWPは置けない", () => {
    const { s, id } = expanded();
    expect(addWorkPackage(s, wpByName(s, "設計").id, id).ok).toBe(false);
  });

  it("WBSコードの重複・計画日の逆転を拒否する", () => {
    const { s } = expanded();
    const design = wpByName(s, "設計");
    expect(updateNode(s, design.id, { code: "1.1" }).ok).toBe(false);
    expect(updateNode(s, design.id, { plannedStart: "2030-02-01", plannedEnd: "2030-01-01" }).ok).toBe(false);
    const s2 = okState(updateNode(s, design.id, { name: "基本設計", plannedStart: "2030-01-06", plannedEnd: "2030-01-10" }));
    expect(wpByName(s2, "基本設計").plannedEnd).toBe("2030-01-10");
  });

  it("必須WPは削除できず、作業区分も変えられない。対象外には理由を付けてできる", () => {
    const { s } = expanded();
    const op = wpByName(s, "運用設計");
    expect(removalImpact(s, op.id).blocker).toMatch(/必須WP/);
    expect(removeNode(s, op.id).ok).toBe(false);
    expect(updateNode(s, op.id, { category: "functional" }).ok).toBe(false);
    expect(setExcluded(s, op.id, true, " ").ok).toBe(false);
    const s2 = okState(setExcluded(s, op.id, true, "本番リリースなし"));
    expect(wpByName(s2, "運用設計")).toMatchObject({ excluded: true, excludedReason: "本番リリースなし" });
    const s3 = okState(setExcluded(s2, op.id, false, ""));
    expect(wpByName(s3, "運用設計").excludedReason).toBe("");
  });

  it("フェーズを削除すると、子のWP・見積・紐付けも消え、その件数を事前に数えられる", () => {
    const { s: s0, id } = expanded();
    const design = wpByName(s0, "設計");
    let s = okState(setEstimate(s0, design.id, { hours: 3, basis: "x" }, id));
    s = okState(setTrace(s, design.id, s.objectives[0].id, true, id));
    const phase = s.wbsNodes.find((n) => n.id === design.parentId);
    expect(removalImpact(s, phase?.id ?? "")).toEqual({ nodes: 4, estimates: 1, traces: 1, blocker: null });
    s = okState(removeNode(s, phase?.id ?? ""));
    expect(s.wbsNodes.some((n) => n.name === "設計")).toBe(false);
    expect(s.estimates).toEqual([]);
    expect(s.objectiveTraces).toEqual([]);
  });

  it("確定済みのベースラインに含まれるWPは削除できない", () => {
    const r = validateState(fixtureRaw());
    if (!r.ok) throw new Error(r.errors.join());
    expect(removalImpact(r.state, "n2").blocker).toMatch(/ベースライン/);
  });
});

describe("要素の編集の守り", () => {
  it("最新のベースラインに含まれるWPは、理由を付けて対象外にできない（改版で外す）", () => {
    const r = validateState(fixtureRaw());
    if (!r.ok) throw new Error(r.errors.join());
    expect(setExcluded(r.state, "n2", true, "不要になった")).toEqual({
      ok: false,
      error: "最新のベースラインに含まれるWPのため、ここでは対象外にできません。改版するときに外してください",
    });
  });

  it("必須WPの作業名は空にできない（名前の変更はできる）", () => {
    const { s } = expanded();
    const req = s.wbsNodes.find((n) => n.requiredKey === "threat_analysis");
    if (!req) throw new Error("必須WPがありません");
    expect(updateNode(s, req.id, { name: "  " })).toEqual({ ok: false, error: "必須WPの作業名は空にできません" });
    expect(okState(updateNode(s, req.id, { name: "脅威分析（STRIDE）" })).wbsNodes.find((n) => n.id === req.id)?.name).toBe("脅威分析（STRIDE）");
  });

  it("変えてよい項目以外は、渡されても変えない", () => {
    const { s: s0 } = expanded();
    const req = s0.wbsNodes.find((n) => n.requiredKey === "threat_analysis");
    if (!req) throw new Error("必須WPがありません");
    const patch = { name: "脅威分析（改）", requiredKey: null, kind: "phase", excluded: true, id: "x" } as unknown as Parameters<typeof updateNode>[2];
    const s = okState(updateNode(s0, req.id, patch));
    expect(s.wbsNodes.find((n) => n.id === req.id)).toEqual({ ...req, name: "脅威分析（改）" });
  });

  it("計画日は2000〜2099年の日付だけを受け付ける（極端な期間で営業日の計算が止まらないように）", () => {
    const { s } = expanded();
    const wp = wpByName(s, "設計");
    expect(updateNode(s, wp.id, { plannedEnd: "9999-12-31" })).toEqual({ ok: false, error: "計画日は2000〜2099年の日付にしてください" });
    expect(updateNode(s, wp.id, { plannedStart: "1999-12-31" }).ok).toBe(false);
    expect(updateNode(s, wp.id, { plannedStart: "2099-12-31" }).ok).toBe(true);
  });

  it("WBSコードは前後の空白を除いて保存し、形式に合わないコードは拒否する", () => {
    const { s: s0 } = expanded();
    const wp = wpByName(s0, "設計");
    const s = okState(updateNode(s0, wp.id, { code: " 2.9 " }));
    expect(s.wbsNodes.find((n) => n.id === wp.id)?.code).toBe("2.9");
    for (const code of ["=1+1", "@x", "-1", "1 2"]) expect(updateNode(s0, wp.id, { code }).ok).toBe(false);
  });

  it("欠けている必須WPを集計で示す（テンプレートを使わずに作ったWBS）", () => {
    const id = ids();
    let s = okState(addPhase(createInitialState(), id));
    expect(planSummary(s).missingRequiredKeys).toEqual([...REQUIRED_WP_KEYS]);
    s = expanded().s;
    expect(planSummary(s).missingRequiredKeys).toEqual([]);
  });

  it("見積基準が無ければ、展開しなくても仮の見積基準を入れられる（既にあれば変えない）", () => {
    const id = ids();
    const s = okState(seedProvisionalStandards(createInitialState(), id));
    expect(s.estimationStandards.length).toBeGreaterThan(0);
    expect(s.estimationStandards.every((x) => x.provisional)).toBe(true);
    expect(okState(seedProvisionalStandards(s, id)).estimationStandards).toEqual(s.estimationStandards);
  });
});

describe("目的の紐付け（F02）と集計", () => {
  it("未紐付けの数は、対象外のWPとphaseを除いて数える", () => {
    const { s: s0, id } = expanded();
    const before = planSummary(s0);
    expect(before.unlinkedCount).toBe(before.targetCount);
    let s = okState(setExcluded(s0, wpByName(s0, "運用設計").id, true, "本番リリースなし"));
    s = okState(setTrace(s, wpByName(s, "設計").id, s.objectives[0].id, true, id));
    const after = planSummary(s);
    expect(after.excludedCount).toBe(1);
    expect(after.unlinkedCount).toBe(before.unlinkedCount - 2);
    expect(isUnlinked(s, wpByName(s, "運用設計"))).toBe(false);
    expect(isUnlinked(s, s.wbsNodes[0])).toBe(false); // phase
  });

  it("紐付けを外す・貢献の内容を書ける。同じ紐付けは二重にならない", () => {
    const { s: s0, id } = expanded();
    const wp = wpByName(s0, "設計").id;
    const objectiveId = s0.objectives[0].id;
    let s = okState(setTrace(s0, wp, objectiveId, true, id));
    s = okState(setTrace(s, wp, objectiveId, true, id));
    expect(s.objectiveTraces).toHaveLength(1);
    s = okState(updateContribution(s, s.objectiveTraces[0].id, "基準線の前提"));
    expect(s.objectiveTraces[0].contribution).toBe("基準線の前提");
    s = okState(setTrace(s, wp, objectiveId, false, id));
    expect(s.objectiveTraces).toEqual([]);
  });

  it("phase は紐付けられない", () => {
    const { s, id } = expanded();
    expect(setTrace(s, s.wbsNodes[0].id, s.objectives[0].id, true, id).ok).toBe(false);
  });
});

describe("見積（F04）", () => {
  it("手入力の見積と、見積基準の適用（工数＝単位あたり×数量、根拠に「仮」）", () => {
    const { s: s0, id } = expanded();
    const wp = wpByName(s0, "設計").id;
    let s = okState(setEstimate(s0, wp, { hours: 2.5, basis: "過去の類似作業" }, id));
    expect(planSummary(s)).toMatchObject({ totalHours: 2.5, standardAppliedCount: 0 });
    const std = s.estimationStandards[0];
    s = okState(applyStandard(s, wp, std.id, 3, id));
    const e = s.estimates.find((x) => x.wbsNodeId === wp);
    expect(e).toMatchObject({ hours: std.hoursPerUnit * 3, standardId: std.id });
    expect(e?.basis).toMatch(/（仮）/);
    expect(planSummary(s).standardAppliedCount).toBe(1);
    // 工数を手で変えたら、見積基準の適用は外れる
    s = okState(setEstimate(s, wp, { hours: 9, basis: e?.basis ?? "" }, id));
    expect(planSummary(s).standardAppliedCount).toBe(0);
  });

  it("根拠だけを手で書き換えても、工数を空にしても、見積基準の適用は外れる", () => {
    const { s: s0, id } = expanded();
    const wp = wpByName(s0, "設計").id;
    const std = s0.estimationStandards[0];
    const applied = okState(applyStandard(s0, wp, std.id, 2, id));
    const hours = applied.estimates[0].hours;
    expect(planSummary(okState(setEstimate(applied, wp, { hours, basis: "手で書いた根拠" }, id))).standardAppliedCount).toBe(0);
    const cleared = okState(setEstimate(applied, wp, { hours: null, basis: applied.estimates[0].basis }, id));
    expect(cleared.estimates[0]).toMatchObject({ hours: 0, standardId: null });
  });

  it("対象外のWPの見積は合計に入れない。範囲外の工数・数量は拒否する", () => {
    const { s: s0, id } = expanded();
    const op = wpByName(s0, "運用設計").id;
    let s = okState(setEstimate(s0, op, { hours: 4, basis: "" }, id));
    s = okState(setExcluded(s, op, true, "本番リリースなし"));
    expect(planSummary(s).totalHours).toBe(0);
    expect(setEstimate(s, op, { hours: -1, basis: "" }, id).ok).toBe(false);
    expect(setEstimate(s, op, { hours: 1e9, basis: "" }, id).ok).toBe(false);
    expect(applyStandard(s, op, s.estimationStandards[0].id, 0, id).ok).toBe(false);
  });

  it("工数を空にすると見積を消す", () => {
    const { s: s0, id } = expanded();
    const wp = wpByName(s0, "設計").id;
    let s = okState(setEstimate(s0, wp, { hours: 1, basis: "" }, id));
    s = okState(setEstimate(s, wp, { hours: null, basis: "" }, id));
    expect(s.estimates).toEqual([]);
  });
});

describe("compareCodes", () => {
  it("区切りごとに数値で比べる", () => {
    expect(["1.10", "1.9", "2", "1"].sort(compareCodes)).toEqual(["1", "1.9", "1.10", "2"]);
  });
});
