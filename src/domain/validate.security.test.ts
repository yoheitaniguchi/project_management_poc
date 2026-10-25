// 読み込むデータの検証のセキュリティテスト（docs/security/checklist.md C・D。PR-Cの計画レビュー PLAN-SEC-007・009）
import { describe, expect, it } from "vitest";
import { validateState } from "./validate";
import { fixtureRaw } from "./testState";

const rejects = (raw: unknown) => validateState(raw).ok === false;
/** 拒否され、その理由が pattern に合うこと（狙った検査で拒否されたかまで確かめる） */
const rejectsWith = (raw: unknown, pattern: RegExp) => {
  const r = validateState(raw);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.errors.join("\n")).toMatch(pattern);
};
const list = (raw: Record<string, unknown>, key: string) => raw[key] as Record<string, unknown>[];

describe("[@security] validateState は不正なデータを拒否する", () => {
  it("[@security] 自分のプロパティとしての __proto__ を、どの階層にあっても拒否し、Object.prototype を汚染しない", () => {
    const top = JSON.parse('{"__proto__":{"polluted":1}}') as unknown;
    rejectsWith(top, /使えない項目名「__proto__」/);
    const raw = fixtureRaw();
    list(raw, "objectives")[0] = JSON.parse(
      '{"id":"o1","code":"O1","content":"","metricName":"","targetValue":"","measurementTiming":"","__proto__":{"polluted":1}}',
    ) as Record<string, unknown>;
    rejectsWith(raw, /objectives\[0\]：使えない項目名「__proto__」/);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it.each(["constructor", "prototype"])("[@security] キー %s を拒否する", (key) => {
    const raw = fixtureRaw();
    (raw.project as Record<string, unknown>)[key] = {};
    rejectsWith(raw, new RegExp(`使えない項目名「${key}」`));
  });

  it("[@security] 知らない項目・足りない項目を拒否する", () => {
    const extra = fixtureRaw();
    extra.unexpected = 1;
    rejectsWith(extra, /知らない項目「unexpected」/);
    const missing = fixtureRaw();
    delete missing.auditLogs;
    rejectsWith(missing, /項目「auditLogs」がありません/);
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
    rejectsWith(raw, /存在しない目的「missing」/);
  });

  it("[@security] 負の工数・整数でない分・数値でない工数・無限大を拒否する", () => {
    const negative = fixtureRaw();
    list(negative, "estimates")[0].hours = -1;
    rejectsWith(negative, /estimates\[0\]\.hours：0未満/);
    const entry = { id: "te1", wbsNodeId: "n2", memberId: null, workDate: "2030-01-08", minutes: 1.5, source: "manual_csv", uniqueKey: "k" };
    const fractional = fixtureRaw();
    fractional.timeEntries = [entry];
    rejectsWith(fractional, /minutes：整数ではありません/);
    const text = fixtureRaw();
    list(text, "estimates")[0].hours = "10";
    rejectsWith(text, /hours：数値ではありません/);
    const inf = fixtureRaw();
    list(inf, "estimates")[0].hours = Infinity;
    rejectsWith(inf, /hours：数値ではありません/);
    const huge = fixtureRaw();
    list(huge, "estimates")[0].hours = 1e308;
    rejectsWith(huge, /hours：上限/);
    const longEntry = fixtureRaw();
    // 手入力の実績は1件24時間まで（Asana の差分は1件で24時間を超えうるので、取込元ごとに確かめる）
    longEntry.timeEntries = [{ ...entry, minutes: 24 * 60 + 1 }];
    rejectsWith(longEntry, /1件の工数が24時間を超えています/);
    const hugeEntry = fixtureRaw();
    hugeEntry.timeEntries = [{ ...entry, source: "asana_csv", minutes: 10_000 * 60 + 1 }];
    rejectsWith(hugeEntry, /minutes：上限/);
  });

  it("[@security] 決められていない列挙値・不正な日付を拒否する", () => {
    const badEnum = fixtureRaw();
    (badEnum.project as Record<string, unknown>).route = "admin";
    rejectsWith(badEnum, /route：決められた値/);
    const badDate = fixtureRaw();
    list(badDate, "wbsNodes")[1].plannedEnd = "2030-02-30";
    rejectsWith(badDate, /plannedEnd：日付/);
  });

  it("[@security] 件数・文字数・入れ子の深さの上限を超えるデータを拒否する", () => {
    const many = fixtureRaw();
    many.objectives = Array.from({ length: 10_001 }, (_, i) => ({ ...list(many, "objectives")[0], id: `o${i}` }));
    rejectsWith(many, /objectives：件数が上限/);
    const long = fixtureRaw();
    (long.proposal as Record<string, unknown>).background = "あ".repeat(10_001);
    rejectsWith(long, /background：文字数が上限/);
    let deep: unknown = {};
    for (let i = 0; i < 30; i++) deep = { x: deep };
    const nested = fixtureRaw();
    (nested.proposal as Record<string, unknown>).background = deep;
    rejectsWith(nested, /入れ子が深すぎます/);
  });

  it("[@security] 対応していない版・オブジェクトでない値を拒否する", () => {
    const future = fixtureRaw();
    future.schemaVersion = 99;
    rejectsWith(future, /対応していない版/);
    expect(rejects(null)).toBe(true);
    expect(rejects([])).toBe(true);
    expect(rejects("text")).toBe(true);
  });
});
