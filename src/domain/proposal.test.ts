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
    s = okState(removeObjective(s, s.objectives[0].id, now, id));
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
    const s = okState(removeObjective(s0, "o1", now, ids()));
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
    const memberId = s.members[0].id;
    // 誰の権限を変えたかが監査ログだけで分かる（メンバーのIDとその時点の氏名を残す）
    expect(s.auditLogs[1]).toMatchObject({
      operator: "テスト太郎",
      before: JSON.stringify({ memberId, name: "テスト太郎", role: "pm" }),
      after: JSON.stringify({ memberId, name: "テスト太郎", role: "member" }),
    });
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

describe("体制：追加のケース", () => {
  it("別のメンバーをPMにしようとすると、すでにPMがいれば拒否する", () => {
    const id = ids();
    let s = okState(addMember(createInitialState(), "pm", now, id));
    s = okState(addMember(s, "member", now, id));
    expect(changeRole(s, s.members[1].id, "pm", now, id).ok).toBe(false);
  });

  it("一般メンバーを削除してもPMは変わらず、削除の監査ログに氏名が残る", () => {
    const id = ids();
    let s = okState(addMember(createInitialState(), "pm", now, id));
    s = okState(addMember(s, "member", now, id));
    s = okState(updateMember(s, s.members[1].id, { name: "テスト次郎" }));
    const pmId = s.project.pmMemberId;
    s = okState(removeMember(s, s.members[1].id, now, id));
    expect(s.project.pmMemberId).toBe(pmId);
    expect(s.auditLogs.at(-1)?.before).toContain("テスト次郎");
  });

  it("文字数の上限を超える入力・決められていない値・undefined を拒否するか無視し、検証に通らない状態を作らない", () => {
    const long = "あ".repeat(10_001);
    expect(updateProposal(createInitialState(), { background: long }).ok).toBe(false);
    expect(updateProject(createInitialState(), { name: long }).ok).toBe(false);
    expect(updateProject(createInitialState(), { route: "admin" as never }).ok).toBe(false);
    const withObjective = okState(addObjective(createInitialState(), ids()));
    expect(updateObjective(withObjective, withObjective.objectives[0].id, { content: long }).ok).toBe(false);
    // undefined の項目は取り除いて扱う（例外にも、検証に通らない状態にもならない）
    okState(updateProject(createInitialState(), { name: undefined }));
    okState(updateObjective(withObjective, withObjective.objectives[0].id, { content: undefined }));
  });

  it("目的の削除は監査ログに残る", () => {
    const s = okState(removeObjective(fixtureState(), "o1", now, ids()));
    expect(s.auditLogs.at(-1)).toMatchObject({ action: "objective.remove", targetId: "o1" });
    expect(s.auditLogs.at(-1)?.before).toContain("テスト目的1");
  });
});

describe("G1+2の差戻し", () => {
  it("差戻しを記録し、監査ログに残す。企画の状態は差戻しになる", () => {
    const s = okState(recordGateReturn(createInitialState(), { reviewer: "監理者", reviewedOn: "2030-01-09", comment: "目的の指標を見直す" }, now, ids()));
    expect(s.gateReviews[0]).toMatchObject({ decision: "returned", baselineId: null, reviewerSelfDeclared: true });
    expect(s.proposal.status).toBe("returned");
    expect(s.auditLogs[0]).toMatchObject({ action: "gate.return", targetId: s.gateReviews[0].id });
  });

  it("差戻しの監査ログに操作者と内容が残る", () => {
    const id = ids();
    let s = okState(addMember(createInitialState(), "pm", now, id));
    s = okState(updateMember(s, s.members[0].id, { name: "テスト太郎" }));
    s = okState(recordGateReturn(s, { reviewer: "監理者", reviewedOn: "2030-01-09", comment: "理由" }, now, id));
    expect(s.auditLogs.at(-1)).toMatchObject({ operator: "テスト太郎", after: JSON.stringify({ reviewer: "監理者", reviewedOn: "2030-01-09", comment: "理由" }) });
  });

  it("v1確定（承認）後の差戻しは記録だけ残し、企画は承認済みのまま", () => {
    const s = okState(recordGateReturn(fixtureState(), { reviewer: "監理者", reviewedOn: "2030-01-12", comment: "改版に向けた差戻し" }, now, ids()));
    expect(s.proposal.status).toBe("approved");
    expect(s.gateReviews.at(-1)?.decision).toBe("returned");
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

  it("確定済みの記録がある状態でも、監査ログ・差戻しの追記は受け付ける（apply）", () => {
    const current = fixtureState();
    const id = ids();
    const next = reducer(current, { type: "apply", op: (s) => addMember(s, "member", now, id) });
    expect(next.members).toHaveLength(2);
    const next2 = reducer(next, { type: "apply", op: (s) => recordGateReturn(s, { reviewer: "監理者", reviewedOn: "2030-01-12", comment: "c" }, now, id) });
    expect(next2.gateReviews).toHaveLength(2);
    expectValidState(next2);
  });

  it("[@security] 確定済みの記録（監査ログ・承認記録・既存の版の明細・スナップショット・承認の状態）の書き換えは受け付けない", () => {
    const current = fixtureState();
    current.evmSnapshots = [{
      id: "s1", baselineId: "b1", asOf: "2030-01-11", pv: 10, ev: 5, ac: 4, bac: 10,
      cpi: 1.25, spi: 0.5, eac: 8, consumptionRate: 0.4, progressRate: 0.5, gapPoints: -10, thresholdPoints: 5, alert: false, createdAt: "2030-01-11T09:00:00.000Z",
    }];
    const mutations: ((s: AppState) => void)[] = [
      (s) => (s.auditLogs[0].operator = "別の人"),
      (s) => (s.gateReviews[0].comment = "書き換え"),
      (s) => (s.baselineItems[0].plannedHours = 99),
      (s) => s.baselineItems.push({ ...s.baselineItems[0], id: "bi2", wbsNodeId: "n4" }),
      (s) => (s.evmSnapshots = []),
      (s) => (s.proposal.approvedOn = "2030-01-08"),
    ];
    for (const mutate of mutations) {
      const next = structuredClone(current);
      mutate(next);
      expect(reducer(current, { type: "commit", next })).toBe(current);
    }
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
