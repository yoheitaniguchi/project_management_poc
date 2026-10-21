import { describe, expect, it } from "vitest";
import { createInitialState } from "./types";
import { isValidDate, validateState } from "./validate";
import { fixtureRaw } from "./testState";

describe("validateState：正しいデータ", () => {
  it("初期状態を受け付ける", () => {
    expect(validateState(createInitialState())).toEqual({ ok: true, state: createInitialState() });
  });

  it("1週目の形の素材（架空データ）を受け付け、内容を保つ", () => {
    const raw = fixtureRaw();
    const result = validateState(raw);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state).toEqual(raw);
  });
});

describe("validateState：整合性（4章のルール）", () => {
  const errorsOf = (mutate: (raw: Record<string, unknown>) => void) => {
    const raw = fixtureRaw();
    mutate(raw);
    const result = validateState(raw);
    return result.ok ? "" : result.errors.join("\n");
  };
  const list = (raw: Record<string, unknown>, key: string) => raw[key] as Record<string, unknown>[];
  /** v2 を正しく足す（各テストはここから1か所だけ壊す） */
  const addV2 = (r: Record<string, unknown>) => {
    list(r, "baselines").push({ ...list(r, "baselines")[0], id: "b2", version: 2, gate: "改版", revisionReason: "テスト用の改版" });
    list(r, "baselineItems").push({ ...list(r, "baselineItems")[0], id: "bi2", baselineId: "b2" });
    list(r, "auditLogs").push({ ...list(r, "auditLogs")[0], id: "a2", seq: 2, targetId: "b2", action: "baseline.revise" });
  };

  it("正しく改版した v2 を受け付ける", () => {
    expect(errorsOf(addV2)).toBe("");
  });

  it("ベースラインの版番号が連番でないと拒否する", () => {
    expect(errorsOf((r) => (list(r, "baselines")[0].version = 2))).toMatch(/baselines：版番号が1から連番/);
  });

  it("v2以降に改版理由が無いと拒否する", () => {
    expect(errorsOf((r) => (addV2(r), (list(r, "baselines")[1].revisionReason = null)))).toMatch(/v2に改版理由がありません/);
  });

  it("v1は確定、v2以降は改版の監査ログが要る", () => {
    expect(errorsOf((r) => (r.auditLogs = []))).toMatch(/v1の確定の監査ログがありません/);
    expect(errorsOf((r) => (addV2(r), (list(r, "auditLogs")[1].action = "baseline.confirm")))).toMatch(/v2の改版の監査ログがありません/);
  });

  it("v1に対応するG1+2承認の記録が要る", () => {
    expect(errorsOf((r) => (r.gateReviews = []))).toMatch(/v1に対応するG1\+2承認の記録がありません/);
  });

  it("明細が無い版・計画工数0の明細を拒否する", () => {
    expect(errorsOf((r) => (r.baselineItems = []))).toMatch(/v1に明細がありません/);
    expect(errorsOf((r) => (list(r, "baselineItems")[0].plannedHours = 0))).toMatch(/baselineItems\[0\]：計画工数が0です/);
  });

  it("承認済みの企画に承認日が無いと拒否する", () => {
    expect(errorsOf((r) => ((r.proposal as Record<string, unknown>).approvedOn = null))).toMatch(/承認済みなのに承認日がありません/);
  });

  it("監査ログの連番が飛んでいると拒否する", () => {
    expect(errorsOf((r) => (list(r, "auditLogs")[0].seq = 2))).toMatch(/auditLogs\[0\]：連番が1ではありません/);
  });

  it("参照切れを拒否する", () => {
    expect(errorsOf((r) => (list(r, "baselineItems")[0].wbsNodeId = "nope"))).toMatch(/baselineItems\[0\]\.wbsNodeId：存在しない/);
    expect(errorsOf((r) => (list(r, "gateReviews")[0].baselineId = "nope"))).toMatch(/gateReviews\[0\]\.baselineId：存在しない/);
    expect(errorsOf((r) => (list(r, "estimates")[0].standardId = "nope"))).toMatch(/estimates\[0\]\.standardId：存在しない/);
    expect(errorsOf((r) => ((r.project as Record<string, unknown>).pmMemberId = "nope"))).toMatch(/project\.pmMemberId：存在しない/);
    const snapshot = {
      id: "s1", baselineId: "nope", asOf: "2030-01-11", pv: 0, ev: 0, ac: 0, bac: 10,
      cpi: null, spi: null, eac: null, consumptionRate: 0, progressRate: 0, createdAt: "2030-01-11T09:00:00.000Z",
    };
    expect(errorsOf((r) => (r.evmSnapshots = [snapshot]))).toMatch(/evmSnapshots\[0\]\.baselineId：存在しない/);
    const entry = { id: "te1", wbsNodeId: "nope", memberId: null, workDate: "2030-01-08", minutes: 60, source: "manual_csv", uniqueKey: "k1" };
    expect(errorsOf((r) => (r.timeEntries = [entry]))).toMatch(/timeEntries\[0\]\.wbsNodeId：存在しない/);
  });

  it("計画開始日が計画終了日より後なら拒否する", () => {
    expect(errorsOf((r) => (list(r, "wbsNodes")[1].plannedStart = "2030-02-01"))).toMatch(/wbsNodes\[1\]：計画開始日/);
    expect(errorsOf((r) => (list(r, "baselineItems")[0].plannedStart = "2030-02-01"))).toMatch(/baselineItems\[0\]：計画開始日/);
  });

  it("IDの重複を拒否する", () => {
    expect(errorsOf((r) => list(r, "objectives").push({ ...list(r, "objectives")[0] }))).toMatch(/objectives：ID「o1」が重複/);
  });

  it("TimeEntryの一意キーの重複を拒否する", () => {
    const entry = { id: "te1", wbsNodeId: "n2", memberId: "m1", workDate: "2030-01-08", minutes: 60, source: "manual_csv", uniqueKey: "k1" };
    expect(errorsOf((r) => (r.timeEntries = [entry, { ...entry, id: "te2" }]))).toMatch(/一意キー「k1」が重複/);
  });

  it("書き出し日時の形式を確かめる", () => {
    expect(errorsOf((r) => (r.lastExportedAt = "2030/01/11"))).toMatch(/lastExportedAt：日時/);
  });

  it("承認者・操作者が自己申告であることの記録が欠けたら拒否する", () => {
    expect(errorsOf((r) => (list(r, "baselines")[0].approverSelfDeclared = false))).toMatch(/approverSelfDeclared/);
    expect(errorsOf((r) => (list(r, "gateReviews")[0].reviewerSelfDeclared = false))).toMatch(/reviewerSelfDeclared/);
  });
});

describe("isValidDate", () => {
  it.each([
    ["2030-01-31", true],
    ["2030-02-29", false],
    ["2028-02-29", true],
    ["2030-1-01", false],
    ["2030-13-01", false],
  ])("%s → %s", (s, expected) => {
    expect(isValidDate(s)).toBe(expected);
  });
});
