// 読み込むデータの検証のセキュリティテスト（docs/security/checklist.md C・D。PR-Cの計画レビュー PLAN-SEC-007・009）
import { describe, expect, it } from "vitest";
import { validateState } from "./validate";
import { fixtureRaw } from "./testState";

const rejects = (raw: unknown) => validateState(raw).ok === false;
const list = (raw: Record<string, unknown>, key: string) => raw[key] as Record<string, unknown>[];

describe("[@security] validateState は不正なデータを拒否する", () => {
  it("[@security] 自分のプロパティとしての __proto__ を、どの階層にあっても拒否し、Object.prototype を汚染しない", () => {
    const top = JSON.parse('{"__proto__":{"polluted":1}}') as unknown;
    expect(rejects(top)).toBe(true);
    const raw = fixtureRaw();
    list(raw, "objectives")[0] = JSON.parse(
      '{"id":"o1","code":"O1","content":"","metricName":"","targetValue":"","measurementTiming":"","__proto__":{"polluted":1}}',
    ) as Record<string, unknown>;
    expect(rejects(raw)).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it.each(["constructor", "prototype"])("[@security] キー %s を拒否する", (key) => {
    const raw = fixtureRaw();
    (raw.project as Record<string, unknown>)[key] = {};
    expect(rejects(raw)).toBe(true);
  });

  it("[@security] 知らない項目・足りない項目を拒否する", () => {
    const extra = fixtureRaw();
    extra.unexpected = 1;
    expect(rejects(extra)).toBe(true);
    const missing = fixtureRaw();
    delete missing.auditLogs;
    expect(rejects(missing)).toBe(true);
  });

  it("[@security] WBSの親子の循環を拒否する（無限ループにならない）", () => {
    const raw = fixtureRaw();
    list(raw, "wbsNodes")[0].parentId = "n2";
    const result = validateState(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join()).toMatch(/循環/);
  });

  it("[@security] 存在しないIDへの参照を拒否する", () => {
    const raw = fixtureRaw();
    list(raw, "objectiveTraces")[0].objectiveId = "missing";
    expect(rejects(raw)).toBe(true);
  });

  it("[@security] 負の工数・整数でない分・数値でない工数・無限大を拒否する", () => {
    const negative = fixtureRaw();
    list(negative, "estimates")[0].hours = -1;
    expect(rejects(negative)).toBe(true);
    const entry = { id: "te1", wbsNodeId: "n2", memberId: null, workDate: "2030-01-08", minutes: 1.5, source: "manual_csv", uniqueKey: "k" };
    const fractional = fixtureRaw();
    fractional.timeEntries = [entry];
    expect(rejects(fractional)).toBe(true);
    const text = fixtureRaw();
    list(text, "estimates")[0].hours = "10";
    expect(rejects(text)).toBe(true);
    const inf = fixtureRaw();
    list(inf, "estimates")[0].hours = Infinity;
    expect(rejects(inf)).toBe(true);
  });

  it("[@security] 決められていない列挙値・不正な日付を拒否する", () => {
    const badEnum = fixtureRaw();
    (badEnum.project as Record<string, unknown>).route = "admin";
    expect(rejects(badEnum)).toBe(true);
    const badDate = fixtureRaw();
    list(badDate, "wbsNodes")[1].plannedEnd = "2030-02-30";
    expect(rejects(badDate)).toBe(true);
  });

  it("[@security] 件数・文字数・入れ子の深さの上限を超えるデータを拒否する", () => {
    const many = fixtureRaw();
    many.objectives = Array.from({ length: 10_001 }, (_, i) => ({ ...list(many, "objectives")[0], id: `o${i}` }));
    expect(rejects(many)).toBe(true);
    const long = fixtureRaw();
    (long.proposal as Record<string, unknown>).background = "あ".repeat(10_001);
    expect(rejects(long)).toBe(true);
    let deep: unknown = {};
    for (let i = 0; i < 30; i++) deep = { x: deep };
    const nested = fixtureRaw();
    (nested.proposal as Record<string, unknown>).background = deep;
    expect(rejects(nested)).toBe(true);
  });

  it("[@security] 対応していない版・オブジェクトでない値を拒否する", () => {
    const future = fixtureRaw();
    future.schemaVersion = 99;
    expect(rejects(future)).toBe(true);
    expect(rejects(null)).toBe(true);
    expect(rejects([])).toBe(true);
    expect(rejects("text")).toBe(true);
  });
});
