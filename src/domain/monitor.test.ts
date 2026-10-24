// 週次監視画面の判定：残りのWP、実績が未入力のWP、古い版のスナップショット、算出できない理由
import { describe, expect, it } from "vitest";
import { confirmBaseline, reviseBaseline } from "./baseline";
import { clearCompleted, setCompleted } from "./completion";
import { isOutdatedSnapshot, remainingWps, unavailableReason, wpsWithoutActuals } from "./monitor";
import type { OpResult } from "./proposal";
import { addMember, addObjective, updateMember } from "./proposal";
import { createSnapshot } from "./snapshot";
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
const at = (day: number, hour = 18) => new Date(2026, 9, day, hour, 0);

/**
 * 計画（v1、合意日 10/26）：設計 10/26〜10/30、開発 10/29〜11/03、試験 11/02〜11/06。
 * 設計は 10/28 に完了（実績なし）、開発は 10/29 に実績あり
 */
function planned() {
  const id = ids();
  let s = okState(addMember(createInitialState(), "pm", at(26), id));
  s = okState(updateMember(s, s.members[0].id, { name: "PM" }));
  s = okState(addObjective(s, id));
  s = okState(expandTemplate(s, id));
  const plan: Record<string, [string, string]> = {
    設計: ["2026-10-26", "2026-10-30"],
    開発: ["2026-10-29", "2026-11-03"],
    テスト: ["2026-11-02", "2026-11-06"],
  };
  for (const n of targetWorkPackages(s)) {
    const p = plan[n.name];
    if (!p) {
      s = okState(setExcluded(s, n.id, true, "例では使わない"));
      continue;
    }
    s = okState(setTrace(s, n.id, s.objectives[0].id, true, id));
    s = okState(setEstimate(s, n.id, { hours: 8, basis: "" }, id));
    s = okState(updateNode(s, n.id, { plannedStart: p[0], plannedEnd: p[1] }));
  }
  s = okState(confirmBaseline(s, { approver: "監理者", approvedOn: "2026-10-26", comment: "" }, at(26), id));
  const wp = (name: string) => s.wbsNodes.find((x) => x.name === name)!.id;
  s = okState(setCompleted(s, wp("設計"), "2026-10-28", at(28), id));
  const entry: TimeEntry = {
    id: "te1", wbsNodeId: wp("開発"), memberId: s.members[0].id, workDate: "2026-10-29", minutes: 120,
    source: "manual_csv", uniqueKey: `manual_csv:2026-10-29:${wp("開発")}:テスト`,
  };
  s = { ...s, timeEntries: [entry] };
  expectValidState(s);
  return { s, id, wp };
}

describe("残りのWPと実績が未入力のWP（表示中のスナップショットの基準日と版で判定）", () => {
  it("基準日 10/30：残りは開発・テスト。未入力は設計（完了でも実績0件なら含める）。テストは計画開始前なので含めない", () => {
    const { s, id } = planned();
    const next = okState(createSnapshot(s, "2026-10-30", at(30), id));
    const snap = next.evmSnapshots[0];
    expect(remainingWps(next, snap).map((x) => x.node.name)).toEqual(["開発", "テスト"]);
    expect(wpsWithoutActuals(next, snap).map((x) => x.node.name)).toEqual(["設計"]);
  });

  it("基準日 10/27：設計はまだ完了ではない。開発は計画開始前なので未入力に含めない", () => {
    const { s, id } = planned();
    const next = okState(createSnapshot(s, "2026-10-27", at(30), id));
    const snap = next.evmSnapshots[0];
    expect(remainingWps(next, snap).map((x) => x.node.name)).toEqual(["設計", "開発", "テスト"]);
    expect(wpsWithoutActuals(next, snap).map((x) => x.node.name)).toEqual(["設計"]);
  });

  it("基準日より後の作業日の実績は数えない（基準日 10/30 で、設計に 10/31 の実績があっても未入力に残る）", () => {
    const { s, id, wp } = planned();
    const late: TimeEntry = { ...s.timeEntries[0], id: "te2", wbsNodeId: wp("設計"), workDate: "2026-10-31", uniqueKey: `manual_csv:2026-10-31:${wp("設計")}:テスト` };
    const next = okState(createSnapshot({ ...s, timeEntries: [...s.timeEntries, late] }, "2026-10-30", at(31), id));
    expect(wpsWithoutActuals(next, next.evmSnapshots[0]).map((x) => x.node.name)).toEqual(["設計"]);
  });

  it("境界：基準日当日を含む（計画開始日・作業日・完了日が基準日と同じ日）", () => {
    const { s, id } = planned();
    // 基準日 10/29：開発の計画開始日と実績の作業日が当日 → 未入力ではない。設計は完了（10/28）
    const d29 = okState(createSnapshot(s, "2026-10-29", at(30), id));
    expect(wpsWithoutActuals(d29, d29.evmSnapshots[0]).map((x) => x.node.name)).toEqual(["設計"]);
    // 基準日 10/28：設計の完了日が当日 → 残りに含めない。開発は計画開始前
    const d28 = okState(createSnapshot(s, "2026-10-28", at(30), id));
    expect(remainingWps(d28, d28.evmSnapshots[0]).map((x) => x.node.name)).toEqual(["開発", "テスト"]);
    // 作成前のプレビュー（基準日と版だけ）でも同じ判定を使える
    expect(remainingWps(s, { asOf: "2026-10-28", baselineId: s.baselines[0].id }).map((x) => x.node.name)).toEqual(["開発", "テスト"]);
  });

  it("完了を取り消すと、記録した後でも、残りのWPは今のデータに従う", () => {
    const { s, id, wp } = planned();
    const next = okState(createSnapshot(s, "2026-10-30", at(30), id));
    const undone = okState(clearCompleted(next, wp("設計"), at(31), id));
    expect(remainingWps(undone, undone.evmSnapshots[0]).map((x) => x.node.name)).toEqual(["設計", "開発", "テスト"]);
  });

  it("計画開始日は、ベースラインの明細の凍結した値で判定する（WBSの計画日を後で変えても変わらない）", () => {
    const { s, id, wp } = planned();
    const next = okState(createSnapshot(s, "2026-10-30", at(30), id));
    const moved = okState(updateNode(next, wp("テスト"), { plannedStart: "2026-10-26" }));
    expect(wpsWithoutActuals(moved, moved.evmSnapshots[0]).map((x) => x.node.name)).toEqual(["設計"]);
  });

  it("改版の後、古い版のスナップショットは古い版の明細で判定し、古い版であることが分かる", () => {
    const { s, id, wp } = planned();
    const v1 = okState(createSnapshot(s, "2026-10-30", at(30), id));
    const v2 = okState(
      reviseBaseline(v1, { approver: "監理者", approvedOn: "2026-10-30", comment: "", revisionReason: "テストを外す", exclusions: [{ wbsNodeId: wp("テスト"), reason: "範囲外" }] }, at(30, 19), id),
    );
    expect(isOutdatedSnapshot(v2, v2.evmSnapshots[0])).toBe(true);
    expect(remainingWps(v2, v2.evmSnapshots[0]).map((x) => x.node.name)).toEqual(["開発", "テスト"]);
    const again = okState(createSnapshot(v2, "2026-10-30", at(30, 20), id));
    expect(isOutdatedSnapshot(again, again.evmSnapshots[1])).toBe(false);
    expect(remainingWps(again, again.evmSnapshots[1]).map((x) => x.node.name)).toEqual(["開発"]);
  });
});

describe("unavailableReason：算出できない指標の理由", () => {
  const base = { ac: 0, pv: 0, bac: 0, cpi: null, spi: null, eac: null, consumptionRate: null, progressRate: null };
  it("指標ごとに5章の定義から理由を返す。算出できるなら null", () => {
    expect(unavailableReason(base, "cpi")).toMatch(/AC）がまだ0/);
    expect(unavailableReason(base, "spi")).toMatch(/PV）が0/);
    expect(unavailableReason(base, "eac")).toMatch(/CPIが算出できない/);
    expect(unavailableReason({ ...base, ac: 2, cpi: 0 }, "eac")).toMatch(/CPIが0のため（EVが0）/);
    expect(unavailableReason(base, "consumptionRate")).toMatch(/BACが0/);
    expect(unavailableReason(base, "progressRate")).toMatch(/BACが0/);
    expect(unavailableReason({ ...base, cpi: 1.2 }, "cpi")).toBeNull();
  });
});
