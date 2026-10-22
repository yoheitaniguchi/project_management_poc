import { describe, expect, it } from "vitest";
import {
  applyExclusions,
  bacOf,
  baselineBlockers,
  confirmBaseline,
  hasBlockers,
  itemsOf,
  latestBaseline,
  reviseBaseline,
  type RevisionInput,
} from "./baseline";
import type { OpResult } from "./proposal";
import { addMember, addObjective, recordGateReturn, updateMember } from "./proposal";
import { acceptCommit, reducer } from "./reducer";
import { frozenRecordChanges } from "./persistence";
import { expectValidState } from "./testState";
import { createInitialState, type AppState } from "./types";
import { addWorkPackage, expandTemplate, setEstimate, setExcluded, setTrace, targetWorkPackages, updateNode } from "./wbs";

const ids = () => {
  let n = 0;
  return () => `id${++n}`;
};
const okState = (r: OpResult): AppState => {
  if (!r.ok) throw new Error(r.error);
  expectValidState(r.state);
  return r.state;
};
const NOW = new Date(2026, 9, 28, 10, 0); // 2026-10-28（水）

/** 確定できる計画：PM・目的1件、テンプレートを展開し、必須WPは対象外、残りのWPに紐付け・見積・計画日を入れる */
function plannedState() {
  const id = ids();
  let s = okState(addMember(createInitialState(), "pm", NOW, id));
  s = okState(updateMember(s, s.members[0].id, { name: "PM太郎" }));
  s = okState(addObjective(s, id));
  s = okState(expandTemplate(s, id));
  for (const n of s.wbsNodes.filter((x) => x.requiredKey !== null)) s = okState(setExcluded(s, n.id, true, "本番リリースなし"));
  for (const n of targetWorkPackages(s)) {
    s = okState(setTrace(s, n.id, s.objectives[0].id, true, id));
    s = okState(setEstimate(s, n.id, { hours: 2, basis: "テスト" }, id));
    s = okState(updateNode(s, n.id, { plannedStart: "2026-10-26", plannedEnd: "2026-10-30" }));
  }
  return { s, id };
}
const approval = { approver: "監理者A", approvedOn: "2026-10-26", comment: "WBS案に合意" };
const wpNamed = (s: AppState, name: string) => {
  const n = s.wbsNodes.find((x) => x.name === name);
  if (!n) throw new Error(name);
  return n;
};

describe("確定できない理由（4章）", () => {
  it("すべて揃っていれば理由は無い", () => {
    expect(hasBlockers(baselineBlockers(plannedState().s))).toBe(false);
  });

  it("未紐付けのWPがあると確定できない（1週目の完了条件）", () => {
    const { s: s0, id } = plannedState();
    const wp = wpNamed(s0, "設計");
    const s = okState(setTrace(s0, wp.id, s0.objectives[0].id, false, id));
    expect(baselineBlockers(s).workPackages).toEqual([{ node: expect.objectContaining({ id: wp.id }), reasons: ["目的に紐付いていません"] }]);
    const r = confirmBaseline(s, approval, NOW, id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/目的に紐付いていません/);
    expect(s.baselines).toEqual([]);
  });

  it("見積が無い・0、計画日が無い、期間に営業日が無い WP を理由付きで挙げる", () => {
    const { s: s0, id } = plannedState();
    let s = okState(setEstimate(s0, wpNamed(s0, "設計").id, { hours: null, basis: "" }, id));
    s = okState(setEstimate(s, wpNamed(s, "開発").id, { hours: 0, basis: "" }, id));
    s = okState(updateNode(s, wpNamed(s, "テスト").id, { plannedEnd: null }));
    s = okState(updateNode(s, wpNamed(s, "要件定義").id, { plannedStart: "2026-10-31", plannedEnd: "2026-11-01" }));
    const reasons = Object.fromEntries(baselineBlockers(s).workPackages.map((b) => [b.node.name, b.reasons]));
    expect(reasons).toEqual({
      設計: ["見積工数が無いか0です"],
      開発: ["見積工数が無いか0です"],
      テスト: ["計画開始日・計画終了日がありません"],
      要件定義: ["計画の期間に営業日がありません"],
    });
  });

  it("設定の祝日だけの期間も、営業日が無いとする", () => {
    const { s: s0 } = plannedState();
    let s = okState(updateNode(s0, wpNamed(s0, "設計").id, { plannedStart: "2026-11-03", plannedEnd: "2026-11-03" }));
    expect(hasBlockers(baselineBlockers(s))).toBe(false);
    s = { ...s, settings: { ...s.settings, holidays: ["2026-11-03"] } };
    expect(baselineBlockers(s).workPackages.map((b) => b.reasons)).toEqual([["計画の期間に営業日がありません"]]);
  });

  it("対象外のWPとphaseは判定から除く。対象のWPが1件も無ければ確定できない", () => {
    const { s: s0 } = plannedState();
    let s = s0;
    for (const n of targetWorkPackages(s0)) s = okState(setExcluded(s, n.id, true, "テスト"));
    expect(baselineBlockers(s)).toEqual({ general: [expect.stringMatching(/対象になるWPがありません/)], workPackages: [] });
  });
});

describe("v1 の確定（G1+2承認と同じ操作）", () => {
  it("版・明細・承認の記録・企画の承認・監査ログを1つの操作で残す", () => {
    const { s: s0, id } = plannedState();
    const s = okState(confirmBaseline(s0, approval, NOW, id));
    const b = latestBaseline(s);
    expect(b).toMatchObject({ version: 1, approvedOn: "2026-10-26", approver: "監理者A", approverSelfDeclared: true, gate: "G1+2", revisionReason: null, operatedAt: NOW.toISOString() });
    if (!b) return;
    // 対象のWP（対象外の必須WP6件を除く）だけを、計画工数・計画日とともに凍結する
    expect(itemsOf(s, b.id).map((x) => x.wbsNodeId).sort()).toEqual(targetWorkPackages(s0).map((n) => n.id).sort());
    expect(itemsOf(s, b.id).every((x) => x.plannedHours === 2 && x.plannedStart === "2026-10-26" && x.plannedEnd === "2026-10-30")).toBe(true);
    expect(bacOf(s, b.id)).toBe(2 * targetWorkPackages(s0).length);
    expect(s.gateReviews).toEqual([
      expect.objectContaining({ decision: "approved", reviewedOn: "2026-10-26", reviewer: "監理者A", reviewerSelfDeclared: true, baselineId: b.id }),
    ]);
    expect(s.proposal).toMatchObject({ status: "approved", approvedOn: "2026-10-26" });
    // この操作で足した監査ログ（PMの登録＝権限の変更のログの後）
    expect(s.auditLogs.slice(s0.auditLogs.length).map((a) => [a.action, a.operator, a.at])).toEqual([
      ["gate.approve", "PM太郎", NOW.toISOString()],
      ["baseline.confirm", "PM太郎", NOW.toISOString()],
    ]);
    expect(JSON.parse(s.auditLogs.at(-1)?.after ?? "{}")).toMatchObject({ version: 1, approvedOn: "2026-10-26", itemCount: targetWorkPackages(s0).length });
    // 確定の操作は、凍結した記録の追記だけ
    expect(frozenRecordChanges(s0, s)).toEqual([]);
  });

  it("合意日は過去の日付を入れられる（O1：合意日を承認日として記録する）が、未来の日付は入れられない", () => {
    const { s, id } = plannedState();
    expect(confirmBaseline(s, { ...approval, approvedOn: "2026-10-29" }, NOW, id)).toEqual({ ok: false, error: "合意日に未来の日付は入れられません" });
    expect(confirmBaseline(s, { ...approval, approvedOn: "2026-10-28" }, NOW, id).ok).toBe(true);
  });

  it("承認者・合意日が無ければ確定しない。確定は1回だけ", () => {
    const { s, id } = plannedState();
    expect(confirmBaseline(s, { ...approval, approver: " " }, NOW, id).ok).toBe(false);
    expect(confirmBaseline(s, { ...approval, approvedOn: "2026-02-30" }, NOW, id).ok).toBe(false);
    const confirmed = okState(confirmBaseline(s, approval, NOW, id));
    expect(confirmBaseline(confirmed, approval, NOW, id)).toEqual({ ok: false, error: expect.stringMatching(/改版/) });
  });

  it("PMが未設定なら、監査ログの操作者は「（PM未設定）」", () => {
    const { s: s0, id } = plannedState();
    const s = okState(confirmBaseline({ ...s0, members: [], projectMembers: [], project: { ...s0.project, pmMemberId: null } }, approval, NOW, id));
    expect(s.auditLogs.every((a) => a.operator === "（PM未設定）")).toBe(true);
  });
});

describe("改版（v2 以降）", () => {
  const confirmed = () => {
    const { s, id } = plannedState();
    return { s: okState(confirmBaseline(s, approval, NOW, id)), id };
  };
  const revision: RevisionInput = { ...approval, approvedOn: "2026-10-28", comment: "", revisionReason: "見積の見直し", exclusions: [] };

  it("計画を変えて改版すると、新しい版を作り、前の版はそのまま残る", () => {
    const { s: s0, id } = confirmed();
    const wp = wpNamed(s0, "設計");
    const s1 = okState(setEstimate(s0, wp.id, { hours: 5, basis: "見直し" }, id));
    const s = okState(reviseBaseline(s1, revision, NOW, id));
    const [v1, v2] = [...s.baselines].sort((a, b) => a.version - b.version);
    expect(v2).toMatchObject({ version: 2, gate: "改版", revisionReason: "見積の見直し" });
    expect(itemsOf(s, v1.id).find((x) => x.wbsNodeId === wp.id)?.plannedHours).toBe(2);
    expect(itemsOf(s, v2.id).find((x) => x.wbsNodeId === wp.id)?.plannedHours).toBe(5);
    expect(s.auditLogs.at(-1)).toMatchObject({ action: "baseline.revise", targetId: v2.id, operator: "PM太郎" });
    expect(JSON.parse(s.auditLogs.at(-1)?.after ?? "{}")).toMatchObject({ version: 2, revisionReason: "見積の見直し" });
    expect(s.gateReviews).toHaveLength(1);
    expect(frozenRecordChanges(s1, s)).toEqual([]);
  });

  it("改版理由が無ければ改版しない。合意日は前の版より前にできない", () => {
    const { s, id } = confirmed();
    expect(reviseBaseline(s, { ...revision, revisionReason: " " }, NOW, id)).toEqual({ ok: false, error: "改版理由を入力してください" });
    expect(reviseBaseline(s, { ...revision, approvedOn: "2026-10-23" }, NOW, id)).toEqual({
      ok: false,
      error: "合意日は、前の版（v1）の合意日 2026-10-26 より前にできません",
    });
  });

  it("v1 に含めたWPを、改版で理由付きで外せる。外したWPは対象外になり、前の版の明細には残る", () => {
    const { s: s0, id } = confirmed();
    const wp = wpNamed(s0, "設計");
    // 最新の版に含まれるWPは、編集画面からは対象外にできない
    expect(setExcluded(s0, wp.id, true, "不要").ok).toBe(false);
    const s = okState(reviseBaseline(s0, { ...revision, exclusions: [{ wbsNodeId: wp.id, reason: "範囲から外した" }] }, NOW, id));
    const v2 = latestBaseline(s);
    expect(s.wbsNodes.find((n) => n.id === wp.id)).toMatchObject({ excluded: true, excludedReason: "範囲から外した" });
    expect(v2 && itemsOf(s, v2.id).some((x) => x.wbsNodeId === wp.id)).toBe(false);
    expect(itemsOf(s, s.baselines[0].id).some((x) => x.wbsNodeId === wp.id)).toBe(true);
    // 改版の記録と、外したWPごとの記録（理由は全文）
    const [revise, exclude] = s.auditLogs.slice(-2);
    expect(revise).toMatchObject({ action: "baseline.revise", targetId: v2?.id });
    expect(JSON.parse(revise.after ?? "{}")).toMatchObject({ excludedCodes: [wp.code], revisionReason: "見積の見直し" });
    expect(exclude).toMatchObject({ action: "baseline.exclude", targetType: "wbsNode", targetId: wp.id });
    expect(JSON.parse(exclude.after ?? "{}")).toMatchObject({ version: 2, code: wp.code, reason: "範囲から外した" });
    // 外したWPは、v2 の後なら（最新の版に含まれないので）対象に戻せる
    expect(setExcluded(s, wp.id, false, "").ok).toBe(true);
  });

  it("外すWPの理由が無い・最新の版に無いWPは拒否する。外した後に確定できない理由があれば改版しない", () => {
    const { s: s0, id } = confirmed();
    const wp = wpNamed(s0, "設計");
    expect(applyExclusions(s0, [{ wbsNodeId: wp.id, reason: "" }]).ok).toBe(false);
    const req = s0.wbsNodes.find((n) => n.requiredKey !== null);
    expect(req && applyExclusions(s0, [{ wbsNodeId: req.id, reason: "x" }]).ok).toBe(false);
    let s = s0;
    for (const n of targetWorkPackages(s0)) s = okState(setTrace(s, n.id, s.objectives[0].id, n.id === wp.id, id));
    // 設計以外が未紐付けの計画：そのままでは未紐付けで、設計を外すと他も未紐付けのまま。どちらも改版せず、状態も変わらない
    const r1 = reviseBaseline(s, revision, NOW, id);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error).toMatch(/目的に紐付いていません/);
    expect(reviseBaseline(s, { ...revision, exclusions: [{ wbsNodeId: wp.id, reason: "x" }] }, NOW, id).ok).toBe(false);
    // 全部外すと、対象になるWPが無いので改版しない
    const all = targetWorkPackages(s0).map((n) => ({ wbsNodeId: n.id, reason: "x" }));
    const r2 = reviseBaseline(s0, { ...revision, exclusions: all }, NOW, id);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toMatch(/対象になるWPがありません/);
  });

  it("改版の入力の誤りを、理由を付けて拒否する", () => {
    const { s: s0, id } = confirmed();
    const wp = wpNamed(s0, "設計");
    const phase = s0.wbsNodes.find((n) => n.kind === "phase");
    const fails = (input: Partial<typeof revision> & Record<string, unknown>) => {
      const r = reviseBaseline(s0, { ...revision, ...input } as typeof revision, NOW, id);
      return r.ok ? "" : r.error;
    };
    expect(fails({ approvedOn: "2026-10-29" })).toMatch(/未来/);
    expect(fails({ approver: "a".repeat(10_001) })).toMatch(/文字数/);
    expect(fails({ revisionReason: "a".repeat(501) })).toMatch(/500文字以内/);
    expect(fails({ exclusions: [{ wbsNodeId: wp.id, reason: "a".repeat(501) }] })).toMatch(/500文字以内/);
    expect(fails({ exclusions: [{ wbsNodeId: wp.id, reason: "x" }, { wbsNodeId: wp.id, reason: "y" }] })).toMatch(/重複/);
    expect(fails({ exclusions: [{ wbsNodeId: phase?.id ?? "", reason: "x" }] })).toMatch(/WPではありません/);
    expect(fails({ exclusions: [{ wbsNodeId: "nope", reason: "x" }] })).toMatch(/見つかりません/);
    expect(fails({ exclusions: [null] as unknown as typeof revision.exclusions })).toMatch(/指定が正しくありません/);
    expect(fails({ exclusions: "x" as unknown as typeof revision.exclusions })).toMatch(/指定が正しくありません/);
    const req = s0.wbsNodes.find((n) => n.requiredKey !== null);
    expect(fails({ exclusions: [{ wbsNodeId: req?.id ?? "", reason: "x" }] })).toMatch(/すでに対象外/);
    // v1 の後に足したWPは最新の版に無いので、改版では外せない（計画画面で対象外にする）
    const added = okState(addWorkPackage(s0, wpNamed(s0, "設計").parentId ?? "", () => "new-wp"));
    const r = reviseBaseline(added, { ...revision, exclusions: [{ wbsNodeId: "new-wp", reason: "x" }] }, NOW, id);
    expect(r.ok ? "" : r.error).toMatch(/最新の版に含まれていません/);
    // v1 が無ければ改版できない
    expect(reviseBaseline(plannedState().s, revision, NOW, id).ok).toBe(false);
  });

  it("長い改版理由・複数の外すWPでも、監査ログは JSON として読め、外したWPと理由が全文で残る", () => {
    const { s: s0, id } = confirmed();
    const names = ["設計", "開発", "テスト"];
    const exclusions = names.map((n) => ({ wbsNodeId: wpNamed(s0, n).id, reason: `${n}を外す理由`.padEnd(500, "。") }));
    const s = okState(reviseBaseline(s0, { ...revision, revisionReason: "あ".repeat(500), exclusions }, NOW, id));
    const logs = s.auditLogs.slice(s0.auditLogs.length);
    expect(logs.map((a) => a.action)).toEqual(["baseline.revise", "baseline.exclude", "baseline.exclude", "baseline.exclude"]);
    const after = logs.map((a) => JSON.parse(a.after ?? "null"));
    expect(after[0].revisionReason).toBe("あ".repeat(500));
    expect(after.slice(1).map((x) => x.reason)).toEqual(exclusions.map((x) => x.reason));
  });

  it("合意日は前の版と同じ日でよい。v3 も連番になり、v2 で外したWPを戻して v3 に入れられる", () => {
    const { s: s0, id } = confirmed();
    const wp = wpNamed(s0, "設計");
    let s = okState(reviseBaseline(s0, { ...revision, approvedOn: "2026-10-26", exclusions: [{ wbsNodeId: wp.id, reason: "x" }] }, NOW, id));
    s = okState(setExcluded(s, wp.id, false, ""));
    s = okState(reviseBaseline(s, { ...revision, revisionReason: "設計を戻す" }, NOW, id));
    const v3 = latestBaseline(s);
    expect(v3?.version).toBe(3);
    expect(v3 && itemsOf(s, v3.id).some((x) => x.wbsNodeId === wp.id)).toBe(true);
  });
});

describe("確定の境界", () => {
  it("開始日が終了日より後のWPを理由に挙げる（読み込んだデータなど、編集画面を通らない場合）", () => {
    const { s: s0 } = plannedState();
    const wp = wpNamed(s0, "設計");
    const s = { ...s0, wbsNodes: s0.wbsNodes.map((n) => (n.id === wp.id ? { ...n, plannedStart: "2026-10-30", plannedEnd: "2026-10-26" } : n)) };
    expect(baselineBlockers(s).workPackages).toEqual([{ node: expect.objectContaining({ id: wp.id }), reasons: ["計画開始日が計画終了日より後です"] }]);
  });

  it("端末の時計が直前の監査ログより前に戻っていても、確定・改版の結果は検証に通る", () => {
    const { s: s0, id } = plannedState();
    const later = new Date(2026, 9, 28, 12, 0);
    const s1 = { ...s0, auditLogs: s0.auditLogs.map((a) => ({ ...a, at: later.toISOString() })) };
    const s = okState(confirmBaseline(s1, approval, NOW, id));
    okState(reviseBaseline(s, { ...approval, revisionReason: "r", exclusions: [] }, NOW, id));
  });

  it("差戻しの後でも確定でき、企画は承認済みになる", () => {
    const { s: s0, id } = plannedState();
    const returned = okState(recordGateReturn(s0, { reviewer: "監理者A", reviewedOn: "2026-10-26", comment: "見直し" }, NOW, id));
    expect(returned.proposal.status).toBe("returned");
    expect(okState(confirmBaseline(returned, approval, NOW, id)).proposal.status).toBe("approved");
  });

  it("画面の操作と同じく reducer の apply を通しても受け付けられる", () => {
    const { s: s0, id } = plannedState();
    const s1 = reducer(s0, { type: "apply", op: (s) => confirmBaseline(s, approval, NOW, id) });
    expect(s1.baselines).toHaveLength(1);
    expect(acceptCommit(s0, s1)).toBe(true);
    const s2 = reducer(s1, { type: "apply", op: (s) => reviseBaseline(s, { ...approval, revisionReason: "r", exclusions: [] }, NOW, id) });
    expect(s2.baselines).toHaveLength(2);
  });

  it("BAC は小数の誤差を丸める", () => {
    const { s: s0, id } = plannedState();
    let s = okState(setEstimate(s0, wpNamed(s0, "設計").id, { hours: 0.1, basis: "" }, id));
    s = okState(setEstimate(s, wpNamed(s, "開発").id, { hours: 0.2, basis: "" }, id));
    s = okState(confirmBaseline(s, approval, NOW, id));
    expect(bacOf(s, s.baselines[0].id)).toBe(0.3 + 2 * (targetWorkPackages(s).length - 2));
  });
});
