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
    return result.ok ? [] : result.errors;
  };
  const list = (raw: Record<string, unknown>, key: string) => raw[key] as Record<string, unknown>[];

  it("ベースラインの版番号が連番でないと拒否する", () => {
    expect(errorsOf((r) => (list(r, "baselines")[0].version = 2)).join()).toMatch(/連番/);
  });

  it("v2以降に改版理由が無いと拒否する", () => {
    const errors = errorsOf((r) => {
      list(r, "baselines").push({ ...list(r, "baselines")[0], id: "b2", version: 2, revisionReason: null });
      list(r, "auditLogs").push({ ...list(r, "auditLogs")[0], id: "a2", seq: 2, targetId: "b2", action: "baseline.revise" });
    });
    expect(errors.join()).toMatch(/改版理由/);
  });

  it("確定の監査ログが無いベースラインを拒否する", () => {
    expect(errorsOf((r) => (r.auditLogs = [])).join()).toMatch(/監査ログがありません/);
  });

  it("監査ログの連番が飛んでいると拒否する", () => {
    expect(errorsOf((r) => (list(r, "auditLogs")[0].seq = 2)).join()).toMatch(/連番/);
  });

  it("存在しないWBS要素を参照する明細を拒否する", () => {
    expect(errorsOf((r) => (list(r, "baselineItems")[0].wbsNodeId = "nope")).join()).toMatch(/存在しない/);
  });

  it("計画開始日が計画終了日より後のWBS要素を拒否する", () => {
    expect(errorsOf((r) => (list(r, "wbsNodes")[1].plannedStart = "2030-02-01")).join()).toMatch(/計画開始日/);
  });

  it("IDの重複を拒否する", () => {
    expect(errorsOf((r) => list(r, "objectives").push({ ...list(r, "objectives")[0] })).join()).toMatch(/重複/);
  });

  it("TimeEntryの一意キーの重複を拒否する", () => {
    const entry = { id: "te1", wbsNodeId: "n2", memberId: "m1", workDate: "2030-01-08", minutes: 60, source: "manual_csv", uniqueKey: "k1" };
    expect(errorsOf((r) => (r.timeEntries = [entry, { ...entry, id: "te2" }])).join()).toMatch(/一意キー/);
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
