import { describe, expect, it } from "vitest";
import { clearCompleted, setCompleted } from "./completion";
import { computeEvm, wpStatusAt } from "./evm";
import { frozenRecordChanges } from "./persistence";
import type { OpResult } from "./proposal";
import { addMember, addObjective, updateMember } from "./proposal";
import { confirmBaseline } from "./baseline";
import { expectValidState } from "./testState";
import { createInitialState, type AppState } from "./types";
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
});
