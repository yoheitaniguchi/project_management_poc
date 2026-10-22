// 5章の定義を、手で計算した例で確かめる（工数は時間）
import { describe, expect, it } from "vitest";
import { confirmBaseline, reviseBaseline } from "./baseline";
import { computeEvm, gapPoints, indicators, isAlert, plannedValueOf, wpStatusAt } from "./evm";
import type { OpResult } from "./proposal";
import { addMember, addObjective, updateMember } from "./proposal";
import { expectValidState } from "./testState";
import { createInitialState, type AppState, type TimeEntry } from "./types";
import { expandTemplate, setEstimate, setExcluded, setTrace, targetWorkPackages, updateNode } from "./wbs";

const ids = () => {
  let n = 0;
  return () => `id${++n}`;
};
const okState = (r: OpResult): AppState => {
  if (!r.ok) throw new Error(r.error);
  expectValidState(r.state);
  return r.state;
};
const NOW = new Date(2026, 9, 26, 18, 0);

/**
 * 計画（v1）：
 * - 設計 A：10時間、2026-10-26（月）〜10-30（金）→ 営業日5日、1日2時間
 * - 開発 B：6時間、2026-10-29（木）〜11-03（火）→ 営業日4日（10/29・10/30・11/2・11/3）、1日1.5時間
 * そのほかのWPは対象外。BAC＝16時間
 */
function planned() {
  const id = ids();
  let s = okState(addMember(createInitialState(), "pm", NOW, id));
  s = okState(updateMember(s, s.members[0].id, { name: "PM" }));
  s = okState(addObjective(s, id));
  s = okState(expandTemplate(s, id));
  const plan: Record<string, [number, string, string]> = {
    設計: [10, "2026-10-26", "2026-10-30"],
    開発: [6, "2026-10-29", "2026-11-03"],
  };
  for (const n of targetWorkPackages(s)) {
    const p = plan[n.name];
    if (!p) {
      s = okState(setExcluded(s, n.id, true, "例では使わない"));
      continue;
    }
    s = okState(setTrace(s, n.id, s.objectives[0].id, true, id));
    s = okState(setEstimate(s, n.id, { hours: p[0], basis: "" }, id));
    s = okState(updateNode(s, n.id, { plannedStart: p[1], plannedEnd: p[2] }));
  }
  s = okState(confirmBaseline(s, { approver: "監理者", approvedOn: "2026-10-26", comment: "" }, NOW, id));
  const wp = (name: string) => {
    const n = s.wbsNodes.find((x) => x.name === name);
    if (!n) throw new Error(name);
    return n.id;
  };
  return { s, id, A: wp("設計"), B: wp("開発") };
}

let seq = 0;
const entry = (s: AppState, wbsNodeId: string, workDate: string, minutes: number): TimeEntry => ({
  id: `te${++seq}`,
  wbsNodeId,
  memberId: s.members[0].id,
  workDate,
  minutes,
  source: "manual_csv",
  uniqueKey: `test:${seq}`,
});

/** 実績：A は 10/26 に 10時間、B は 10/29 に 2時間と 10/31（土）に 1時間。A は 10/30 に完了 */
function withActuals() {
  const p = planned();
  const s: AppState = {
    ...p.s,
    wbsNodes: p.s.wbsNodes.map((n) => (n.id === p.A ? { ...n, completedOn: "2026-10-30" } : n)),
    timeEntries: [entry(p.s, p.A, "2026-10-26", 600), entry(p.s, p.B, "2026-10-29", 120), entry(p.s, p.B, "2026-10-31", 60)],
  };
  expectValidState(s);
  return { ...p, s };
}

describe("PV（計画工数を営業日に均等に配分し、基準日までを累計）", () => {
  it("開始日と終了日の両方を営業日に含め、基準日当日を含む", () => {
    const item = { id: "i", baselineId: "b", wbsNodeId: "n", plannedHours: 6, plannedStart: "2026-10-29", plannedEnd: "2026-11-03" };
    expect(plannedValueOf(item, "2026-10-28", [])).toBe(0);
    expect(plannedValueOf(item, "2026-10-29", [])).toBe(1.5);
    expect(plannedValueOf(item, "2026-11-01", [])).toBe(3); // 土日は増えない
    expect(plannedValueOf(item, "2026-11-03", [])).toBe(6);
    expect(plannedValueOf(item, "2026-12-01", [])).toBe(6);
    // 祝日は営業日から除く：11/2 が祝日なら 3日で 2時間ずつ
    expect(plannedValueOf(item, "2026-11-02", ["2026-11-02"])).toBe(4);
  });

  it("期間に営業日が無い明細は、計画終了日に全量を計上する（人間の判断）", () => {
    const item = { id: "i", baselineId: "b", wbsNodeId: "n", plannedHours: 2, plannedStart: "2026-11-03", plannedEnd: "2026-11-03" };
    expect(plannedValueOf(item, "2026-11-02", ["2026-11-03"])).toBe(0);
    expect(plannedValueOf(item, "2026-11-03", ["2026-11-03"])).toBe(2);
  });
});

describe("WPの状態（基準日の時点で判定）", () => {
  it("完了日が基準日以前なら完了、実績が基準日以前にあれば着手、それ以外は未着手", () => {
    const { s, A, B } = withActuals();
    expect(wpStatusAt(s, A, "2026-10-25")).toBe("not_started");
    expect(wpStatusAt(s, A, "2026-10-29")).toBe("in_progress");
    expect(wpStatusAt(s, A, "2026-10-30")).toBe("done");
    expect(wpStatusAt(s, B, "2026-10-28")).toBe("not_started");
    expect(wpStatusAt(s, B, "2026-10-29")).toBe("in_progress");
  });
});

describe("基準日の簡易EVM（手で計算した例）", () => {
  it("2026-10-30（金）", () => {
    const { s } = withActuals();
    const r = computeEvm(s, "2026-10-30");
    // PV：A 10 ＋ B 1.5×2＝3 → 13。EV：A 完了 10 ＋ B 着手 6×50%＝3 → 13。AC：10＋2＝12（10/31 は基準日の後）
    expect(r).toMatchObject({ version: 1, asOf: "2026-10-30", bac: 16, pv: 13, ev: 13, ac: 12 });
    expect(r?.cpi).toBeCloseTo(13 / 12, 10);
    expect(r?.spi).toBe(1);
    expect(r?.eac).toBeCloseTo(16 / (13 / 12), 10);
    expect(r?.consumptionRate).toBe(0.75);
    expect(r?.progressRate).toBe(0.8125);
    // 消化率 − 進捗率 ＝ −6.25 ポイント → −6（要対応ではない）
    expect(r).toMatchObject({ gapPoints: -6, alert: false });
  });

  it("2026-10-29（木）：A はまだ完了していないので着手（50%）", () => {
    const { s } = withActuals();
    // PV：A 2×4＝8 ＋ B 1.5 → 9.5。EV：A 5 ＋ B 3 → 8。AC：12
    expect(computeEvm(s, "2026-10-29")).toMatchObject({ pv: 9.5, ev: 8, ac: 12 });
  });

  it("計画の開始より前：PV が0なので SPI は出さない。実績が無ければ CPI・EAC も出さない", () => {
    const { s } = planned();
    expect(computeEvm(s, "2026-10-23")).toMatchObject({ pv: 0, ev: 0, ac: 0, cpi: null, spi: null, eac: null, consumptionRate: 0, progressRate: 0 });
  });

  it("ベースラインが無い、基準日が日付でないときは計算しない", () => {
    expect(computeEvm(createInitialState(), "2026-10-30")).toBeNull();
    expect(computeEvm(planned().s, "2026-13-01")).toBeNull();
  });

  it("基準は最新の版。改版で外したWPの実績も AC に含める（人間の判断）", () => {
    const { s: s0, id, B } = withActuals();
    const s = okState(
      reviseBaseline(s0, { approver: "監理者", approvedOn: "2026-10-26", comment: "", revisionReason: "開発を外す", exclusions: [{ wbsNodeId: B, reason: "範囲外" }] }, NOW, id),
    );
    const r = computeEvm(s, "2026-10-30");
    // v2：BAC・PV・EV は A だけ（10）。AC は B の実績 2時間も含めて 12
    expect(r).toMatchObject({ version: 2, bac: 10, pv: 10, ev: 10, ac: 12 });
  });

  it("確定の後に祝日を足して営業日が無くなった明細は、計画終了日に全量を計上する", () => {
    const { s: s0 } = planned();
    const s = { ...s0, settings: { ...s0.settings, holidays: ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"] } };
    // A（10/26〜10/30）は営業日が無くなる。B は 11/2・11/3 の2日で 3時間ずつ
    expect(computeEvm(s, "2026-10-29")?.pv).toBe(0);
    expect(computeEvm(s, "2026-10-30")?.pv).toBe(10);
    expect(computeEvm(s, "2026-11-02")?.pv).toBe(13);
  });
});

describe("指標と要対応", () => {
  it("算出できない指標は null", () => {
    expect(indicators(0, 0, 0, 0)).toEqual({ cpi: null, spi: null, eac: null, consumptionRate: null, progressRate: null });
    // EV が0で AC がある → CPI は0、EAC は算出不可
    expect(indicators(10, 2, 0, 3)).toMatchObject({ cpi: 0, spi: 0, eac: null });
  });

  it("ずれはポイント単位に丸めて比べ、閾値ちょうどは要対応にしない", () => {
    // 0.75 − 0.7 は浮動小数では 0.05000000000000004 になるが、5 ポイントとして扱う
    expect(gapPoints(0.75, 0.7)).toBe(5);
    expect(isAlert(gapPoints(0.75, 0.7), 5)).toBe(false);
    expect(isAlert(gapPoints(0.76, 0.7), 5)).toBe(true);
    expect(isAlert(gapPoints(0.5, 0.7), 5)).toBe(false);
    expect(gapPoints(null, 0.5)).toBeNull();
    expect(isAlert(null, 5)).toBe(false);
  });

  it("閾値は設定値を使う", () => {
    const { s: s0 } = withActuals();
    // 10/29：消化率 12/16＝75%、進捗率 8/16＝50% → 25 ポイント
    expect(computeEvm(s0, "2026-10-29")).toMatchObject({ gapPoints: 25, alert: true });
    const s = { ...s0, settings: { ...s0.settings, alertThresholdPoints: 25 } };
    expect(computeEvm(s, "2026-10-29")?.alert).toBe(false);
  });
});
