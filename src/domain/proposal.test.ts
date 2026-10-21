import { describe, expect, it } from "vitest";
import {
  addMember,
  addObjective,
  changeRole,
  memberRemovalBlocker,
  operatorName,
  recordGateReturn,
  removeMember,
  removeObjective,
  tracesOfObjective,
  updateMember,
  updateObjective,
  updateProject,
  updateProposal,
  type OpResult,
} from "./proposal";
import { reducer } from "./reducer";
import { expectValidState, fixtureRaw } from "./testState";
import { createInitialState, type AppState } from "./types";
import { validateState } from "./validate";

const now = new Date("2030-01-12T00:00:00.000Z");
const ids = () => {
  let n = 0;
  return () => `id${++n}`;
};
const fixtureState = (): AppState => {
  const r = validateState(fixtureRaw());
  if (!r.ok) throw new Error(r.errors.join());
  return r.state;
};
/** 成功した結果の状態を取り出し、検証に通ることも確かめる */
const okState = (r: OpResult): AppState => {
  if (!r.ok) throw new Error(r.error);
  expectValidState(r.state);
  return r.state;
};

describe("企画・プロジェクト", () => {
  it("背景・課題・想定工数を更新できる", () => {
    const s = okState(updateProposal(createInitialState(), { background: "背景", issues: "課題", estimatedHours: 32 }));
    expect(s.proposal).toMatchObject({ background: "背景", issues: "課題", estimatedHours: 32 });
  });

  it("想定工数が負・数値でない・上限超えなら理由を返し、状態を変えない", () => {
    for (const h of [-1, Number.NaN, 1e9]) {
      const r = updateProposal(createInitialState(), { estimatedHours: h });
      expect(r.ok).toBe(false);
    }
  });

  it("プロジェクトの名称・ルート・リリースの有無を更新できる", () => {
    const s = okState(updateProject(createInitialState(), { name: "案件", route: "normal", hasRelease: true }));
    expect(s.project).toMatchObject({ name: "案件", route: "normal", hasRelease: true });
  });
});

describe("目的・成功指標", () => {
  it("O1, O2… の順にコードを振り、削除で欠番があっても重複させない", () => {
    const id = ids();
    let s = okState(addObjective(createInitialState(), id));
    s = okState(addObjective(s, id));
    s = okState(removeObjective(s, s.objectives[0].id));
    s = okState(addObjective(s, id));
    expect(s.objectives.map((o) => o.code)).toEqual(["O2", "O3"]);
  });

  it("内容・指標・目標値・測定時期を更新できる", () => {
    const s0 = okState(addObjective(createInitialState(), ids()));
    const s = okState(updateObjective(s0, s0.objectives[0].id, { content: "基準線を作る", metricName: "着手率", targetValue: "100%", measurementTiming: "G2時" }));
    expect(s.objectives[0]).toMatchObject({ code: "O1", content: "基準線を作る", targetValue: "100%" });
  });

  it("目的を削除すると紐付けも消え、紐付いていたWPの数を事前に数えられる", () => {
    const s0 = fixtureState();
    expect(tracesOfObjective(s0, "o1")).toBe(1);
    // 素材は v1 確定済みだが、目的の削除は確定済みの記録を変えない
    const s = okState(removeObjective(s0, "o1"));
    expect(s.objectives).toEqual([]);
    expect(s.objectiveTraces).toEqual([]);
  });
});

describe("体制（メンバーと役割）", () => {
  it("メンバーを加えると役割の付与が監査ログに残り、PMならプロジェクトのPMになる", () => {
    const s = okState(addMember(createInitialState(), "pm", now, ids()));
    expect(s.project.pmMemberId).toBe(s.members[0].id);
    expect(s.auditLogs).toHaveLength(1);
    expect(s.auditLogs[0]).toMatchObject({ action: "role.assign", targetType: "projectMember", operatorSelfDeclared: true });
  });

  it("PMは1名だけ", () => {
    const id = ids();
    const s = okState(addMember(createInitialState(), "pm", now, id));
    expect(addMember(s, "pm", now, id).ok).toBe(false);
  });

  it("役割の変更は監査ログに残り、PMを外すとプロジェクトのPMが空になる", () => {
    const id = ids();
    let s = okState(addMember(createInitialState(), "pm", now, id));
    s = okState(updateMember(s, s.members[0].id, { name: "テスト太郎" }));
    expect(operatorName(s)).toBe("テスト太郎");
    s = okState(changeRole(s, s.members[0].id, "member", now, id));
    expect(s.project.pmMemberId).toBeNull();
    expect(s.auditLogs.map((a) => a.action)).toEqual(["role.assign", "role.change"]);
    expect(s.auditLogs[1]).toMatchObject({ operator: "テスト太郎", before: '{"role":"pm"}', after: '{"role":"member"}' });
  });

  it("同じ役割への変更は何もしない（監査ログも増えない）", () => {
    const id = ids();
    const s = okState(addMember(createInitialState(), "member", now, id));
    expect(okState(changeRole(s, s.members[0].id, "member", now, id))).toBe(s);
  });

  it("メンバーの削除は監査ログに残る。実績工数があるメンバーは削除できない", () => {
    const id = ids();
    const s0 = okState(addMember(createInitialState(), "pm", now, id));
    const s = okState(removeMember(s0, s0.members[0].id, now, id));
    expect(s.members).toEqual([]);
    expect(s.project.pmMemberId).toBeNull();
    expect(s.auditLogs.at(-1)?.action).toBe("role.remove");

    const withEntry = fixtureState();
    withEntry.timeEntries = [{ id: "te1", wbsNodeId: "n2", memberId: "m1", workDate: "2030-01-08", minutes: 60, source: "manual_csv", uniqueKey: "k" }];
    expect(memberRemovalBlocker(withEntry, "m1")).toMatch(/実績工数/);
    expect(removeMember(withEntry, "m1", now, id).ok).toBe(false);
  });
});

describe("G1+2の差戻し", () => {
  it("差戻しを記録し、監査ログに残す。企画の状態は差戻しになる", () => {
    const s = okState(recordGateReturn(createInitialState(), { reviewer: "監理者", reviewedOn: "2030-01-09", comment: "目的の指標を見直す" }, now, ids()));
    expect(s.gateReviews[0]).toMatchObject({ decision: "returned", baselineId: null, reviewerSelfDeclared: true });
    expect(s.proposal.status).toBe("returned");
    expect(s.auditLogs[0]).toMatchObject({ action: "gate.return", targetId: s.gateReviews[0].id });
  });

  it("承認者・日付・コメントが無ければ記録しない", () => {
    const base = { reviewer: "監理者", reviewedOn: "2030-01-09", comment: "理由" };
    expect(recordGateReturn(createInitialState(), { ...base, reviewer: " " }, now, ids()).ok).toBe(false);
    expect(recordGateReturn(createInitialState(), { ...base, reviewedOn: "2030-02-30" }, now, ids()).ok).toBe(false);
    expect(recordGateReturn(createInitialState(), { ...base, comment: "" }, now, ids()).ok).toBe(false);
  });
});

describe("reducer の commit", () => {
  it("ドメイン関数の結果を反映する", () => {
    const r = updateProject(createInitialState(), { name: "案件" });
    if (!r.ok) throw new Error(r.error);
    expect(reducer(createInitialState(), { type: "commit", next: r.state }).project.name).toBe("案件");
  });

  it("[@security] 確定済みの記録を追記以外で変える状態・検証に通らない状態は受け付けない", () => {
    const current = fixtureState();
    const tampered = structuredClone(current);
    tampered.auditLogs = [];
    expect(reducer(current, { type: "commit", next: tampered })).toBe(current);
    const invalid = structuredClone(current);
    invalid.objectives.push({ ...invalid.objectives[0] });
    expect(reducer(current, { type: "commit", next: invalid })).toBe(current);
  });
});
