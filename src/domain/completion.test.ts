import { describe, expect, it } from "vitest";
import { clearCompleted, setCompleted } from "./completion";
import { computeEvm, wpStatusAt } from "./evm";
import { frozenRecordChanges, parseStateText, serializeState } from "./persistence";
import type { OpResult } from "./proposal";
import { addMember, addObjective, updateMember } from "./proposal";
import { confirmBaseline, reviseBaseline } from "./baseline";
import { importManualCsv } from "./timeImport";
import { expectValidState } from "./testState";
import { createInitialState, type AppState } from "./types";
import { addWorkPackage, expandTemplate, removalImpact, setEstimate, setExcluded, setTrace, targetWorkPackages, updateNode } from "./wbs";

const ids = () => {
  let n = 0;
  return () => `id${++n}`;
};
const okState = (r: OpResult): AppState => {
  if (!r.ok) throw new Error(r.error);
  expectValidState(r.state);
  return r.state;
};
const NOW = new Date(2026, 9, 30, 18, 0); // 2026-10-30（金）

function confirmed() {
  const id = ids();
  let s = okState(addMember(createInitialState(), "pm", NOW, id));
  s = okState(updateMember(s, s.members[0].id, { name: "PM太郎" }));
  s = okState(addObjective(s, id));
  s = okState(expandTemplate(s, id));
  for (const n of targetWorkPackages(s)) {
    if (n.name !== "設計") {
      s = okState(setExcluded(s, n.id, true, "例では使わない"));
      continue;
    }
    s = okState(setTrace(s, n.id, s.objectives[0].id, true, id));
    s = okState(setEstimate(s, n.id, { hours: 8, basis: "" }, id));
    s = okState(updateNode(s, n.id, { plannedStart: "2026-10-26", plannedEnd: "2026-10-30" }));
  }
  s = okState(confirmBaseline(s, { approver: "監理者", approvedOn: "2026-10-26", comment: "" }, NOW, id));
  const wp = s.wbsNodes.find((n) => n.name === "設計");
  if (!wp) throw new Error("設計");
  return { s, id, wp: wp.id };
}

describe("WPの完了の手動設定（5章の一時変更）", () => {
  it("完了日を記録し、監査ログに残す。EVM では基準日の時点で完了（100%）になる", () => {
    const { s: s0, id, wp } = confirmed();
    const s = okState(setCompleted(s0, wp, "2026-10-29", NOW, id));
    expect(s.wbsNodes.find((n) => n.id === wp)?.completedOn).toBe("2026-10-29");
    const log = s.auditLogs.at(-1);
    expect(log).toMatchObject({ action: "wbs.complete", targetType: "wbsNode", targetId: wp, operator: "PM太郎" });
    expect(JSON.parse(log?.before ?? "{}")).toEqual({ completedOn: null });
    expect(JSON.parse(log?.after ?? "{}")).toMatchObject({ completedOn: "2026-10-29" });
    expect(frozenRecordChanges(s0, s)).toEqual([]);
    expect(wpStatusAt(s, wp, "2026-10-28")).toBe("not_started");
    expect(computeEvm(s, "2026-10-29")?.ev).toBe(8);
  });

  it("完了を取り消せ、監査ログに残す。完了日の変更も記録する", () => {
    const { s: s0, id, wp } = confirmed();
    let s = okState(setCompleted(s0, wp, "2026-10-29", NOW, id));
    s = okState(setCompleted(s, wp, "2026-10-30", NOW, id));
    expect(JSON.parse(s.auditLogs.at(-1)?.before ?? "{}")).toEqual({ completedOn: "2026-10-29" });
    s = okState(clearCompleted(s, wp, NOW, id));
    expect(s.wbsNodes.find((n) => n.id === wp)?.completedOn).toBeNull();
    expect(s.auditLogs.at(-1)).toMatchObject({ action: "wbs.uncomplete", targetId: wp });
    expect(JSON.parse(s.auditLogs.at(-1)?.before ?? "{}")).toMatchObject({ completedOn: "2026-10-30" });
  });

  it("同じ完了日を入れ直しても、記録を増やさない", () => {
    const { s: s0, id, wp } = confirmed();
    const s = okState(setCompleted(s0, wp, "2026-10-29", NOW, id));
    expect(okState(setCompleted(s, wp, "2026-10-29", NOW, id)).auditLogs).toHaveLength(s.auditLogs.length);
  });

  it("未来の完了日、日付でない値、phase・対象外のWP・完了していないWPの取り消しは拒否する", () => {
    const { s, id, wp } = confirmed();
    expect(setCompleted(s, wp, "2026-10-31", NOW, id)).toEqual({ ok: false, error: "完了日に未来の日付は入れられません" });
    expect(setCompleted(s, wp, "2026/10/29", NOW, id).ok).toBe(false);
    const phase = s.wbsNodes.find((n) => n.kind === "phase")?.id ?? "";
    expect(setCompleted(s, phase, "2026-10-29", NOW, id).ok).toBe(false);
    const excluded = s.wbsNodes.find((n) => n.excluded)?.id ?? "";
    expect(setCompleted(s, excluded, "2026-10-29", NOW, id)).toEqual({ ok: false, error: "対象外のWPは完了にできません" });
    expect(clearCompleted(s, wp, NOW, id)).toEqual({ ok: false, error: "このWPは完了になっていません" });
  });

  it("読み込み時の検証：phase に完了日があるデータは拒否する", () => {
    const { s } = confirmed();
    const phase = s.wbsNodes.find((n) => n.kind === "phase")?.id;
    const bad = { ...s, wbsNodes: s.wbsNodes.map((n) => (n.id === phase ? { ...n, completedOn: "2026-10-29" } : n)) };
    expect(() => expectValidState(bad)).toThrow();
  });

  it("完了の後・取り消しの後の状態を、JSONに書き出して読み込める", () => {
    const { s: s0, id, wp } = confirmed();
    for (const s of [okState(setCompleted(s0, wp, "2026-10-29", NOW, id)), okState(clearCompleted(okState(setCompleted(s0, wp, "2026-10-29", NOW, id)), wp, NOW, id))]) {
      const parsed = parseStateText(serializeState(s));
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.state).toEqual(s);
    }
  });

  it("完了のWPは（どの版にも含まれていなければ）対象外にできない。改版で外したWPの完了日は残り、取り消せる", () => {
    const { s: s0, id, wp } = confirmed();
    const parent = s0.wbsNodes.find((n) => n.id === wp)?.parentId ?? "";
    let s = okState(addWorkPackage(s0, parent, () => "new-wp"));
    s = okState(setCompleted(s, "new-wp", "2026-10-29", NOW, id));
    expect(setExcluded(s, "new-wp", true, "やめた")).toEqual({ ok: false, error: "完了になっているWPは対象外にできません。先に完了を取り消してください" });
    // 版に含まれるWPを完了にしてから改版で外す
    s = okState(setCompleted(s, wp, "2026-10-29", NOW, id));
    s = okState(updateNode(s, "new-wp", { name: "追加", plannedStart: "2026-10-26", plannedEnd: "2026-10-30" }));
    s = okState(setTrace(s, "new-wp", s.objectives[0].id, true, id));
    s = okState(setEstimate(s, "new-wp", { hours: 1, basis: "" }, id));
    s = okState(reviseBaseline(s, { approver: "監理者", approvedOn: "2026-10-27", comment: "", revisionReason: "設計を外す", exclusions: [{ wbsNodeId: wp, reason: "範囲外" }] }, NOW, id));
    expect(s.wbsNodes.find((n) => n.id === wp)).toMatchObject({ excluded: true, completedOn: "2026-10-29" });
    expect(okState(clearCompleted(s, wp, NOW, id)).wbsNodes.find((n) => n.id === wp)?.completedOn).toBeNull();
  });

  it("実績のあるWPは、完了で着手（50%）から完了（100%）に変わり、取り消すと50%に戻る", () => {
    const { s: s0, id, wp } = confirmed();
    const code = s0.wbsNodes.find((n) => n.id === wp)?.code ?? "";
    const s1 = importManualCsv(s0, "a.csv", `作業日,WBSコード,時間,メモ\n2026-10-27,${code},2,`, NOW, id).state;
    expect(computeEvm(s1, "2026-10-30")?.ev).toBe(4);
    const s2 = okState(setCompleted(s1, wp, "2026-10-30", NOW, id));
    expect(computeEvm(s2, "2026-10-30")?.ev).toBe(8);
    expect(computeEvm(okState(clearCompleted(s2, wp, NOW, id)), "2026-10-30")?.ev).toBe(4);
  });

  it("完了日＝今日は受け付ける。日付をまたぐ直前の時刻でも今日で判定する", () => {
    const { s, id, wp } = confirmed();
    expect(setCompleted(s, wp, "2026-10-30", new Date(2026, 9, 30, 23, 59), id).ok).toBe(true);
    expect(setCompleted(s, wp, "2026-10-31", new Date(2026, 9, 30, 23, 59), id).ok).toBe(false);
  });

  it("PMが未設定なら、操作者は「（PM未設定）」。取り消しの記録の後の値、phase・存在しないWPの取り消しの拒否", () => {
    const { s: s0, id, wp } = confirmed();
    const noPm = { ...s0, members: [], projectMembers: [], project: { ...s0.project, pmMemberId: null }, timeEntries: [] };
    const s = okState(setCompleted(noPm, wp, "2026-10-29", NOW, id));
    expect(s.auditLogs.at(-1)?.operator).toBe("（PM未設定）");
    const cleared = okState(clearCompleted(s, wp, NOW, id));
    expect(JSON.parse(cleared.auditLogs.at(-1)?.after ?? "{}")).toEqual({ completedOn: null });
    const phase = s.wbsNodes.find((n) => n.kind === "phase")?.id ?? "";
    expect(clearCompleted(s, phase, NOW, id).ok).toBe(false);
    expect(clearCompleted(s, "nope", NOW, id).ok).toBe(false);
  });

  it("作業名が長くても、監査ログに完了日が残る", () => {
    const { s: s0, id, wp } = confirmed();
    const s1 = okState(updateNode(s0, wp, { name: "あ".repeat(3000) }));
    const s = okState(setCompleted(s1, wp, "2026-10-29", NOW, id));
    expect(s.auditLogs.at(-1)?.after).toMatch(/^\{"completedOn":"2026-10-29"/);
  });

  it("読み込み時の検証：完了日の年が範囲外、どの版にも含まれない対象外のWPの完了日を拒否する", () => {
    const { s } = confirmed();
    const wpOf = (pred: (n: AppState["wbsNodes"][number]) => boolean) => s.wbsNodes.find(pred)?.id;
    const target = wpOf((n) => n.kind === "work_package" && !n.excluded);
    expect(() => expectValidState({ ...s, wbsNodes: s.wbsNodes.map((n) => (n.id === target ? { ...n, completedOn: "1999-12-31" } : n)) })).toThrow();
    const excluded = wpOf((n) => n.excluded);
    expect(() => expectValidState({ ...s, wbsNodes: s.wbsNodes.map((n) => (n.id === excluded ? { ...n, completedOn: "2026-10-29" } : n)) })).toThrow();
  });

  it("完了のWPは削除できない（完了の記録の行き先を失わないように）", () => {
    const { s: s0, id, wp } = confirmed();
    const parent = s0.wbsNodes.find((n) => n.id === wp)?.parentId ?? "";
    let s = okState(addWorkPackage(s0, parent, () => "new-wp"));
    s = okState(setCompleted(s, "new-wp", "2026-10-29", NOW, id));
    expect(removalImpact(s, "new-wp").blocker).toMatch(/先に完了を取り消してください/);
    s = okState(clearCompleted(s, "new-wp", NOW, id));
    expect(removalImpact(s, "new-wp").blocker).toBeNull();
  });

  it("読み込み時の検証：完了日が監査ログの最後の完了の操作と合わないデータは拒否する", () => {
    const { s: s0, id, wp } = confirmed();
    const s = okState(setCompleted(s0, wp, "2026-10-29", NOW, id));
    const withDate = (st: AppState, d: string | null) => ({ ...st, wbsNodes: st.wbsNodes.map((n) => (n.id === wp ? { ...n, completedOn: d } : n)) });
    // 記録なしに完了日を付けた・書き換えた・消した
    expect(() => expectValidState(withDate(s0, "2026-10-29"))).toThrow();
    expect(() => expectValidState(withDate(s, "2026-10-28"))).toThrow();
    expect(() => expectValidState(withDate(s, null))).toThrow();
    // 取り消しの記録の後は、完了日が無いのが正しい
    expectValidState(okState(clearCompleted(s, wp, NOW, id)));
  });
});
