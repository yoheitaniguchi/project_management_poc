// 読み込み・保存・状態の置き換えの整合性のセキュリティテスト（PR-C の security-reviewer 指摘 SEC-001〜006）。
// 脆弱性があれば失敗するように書いている（「安全な状態が保たれること」を assert する）。
import { afterEach, describe, expect, it, vi } from "vitest";
import { appendAuditLog } from "./auditLog";
import { FakeStorage } from "./fakeStorage";
import {
  compareForImport,
  listCorruptBackups,
  loadFromStorage,
  parseStateText,
  saveToStorage,
  STORAGE_KEY,
} from "./persistence";
import { reducer } from "./reducer";
import { fixtureRaw, fixtureText } from "./testState";
import type { AppState } from "./types";
import { LIMITS, validateState } from "./validate";

type Rec = Record<string, unknown>;

const fixtureState = (): AppState => {
  const r = parseStateText(fixtureText());
  if (!r.ok) throw new Error(r.errors.join());
  return r.state;
};

const listOf = (raw: Rec, key: string): Rec[] => raw[key] as Rec[];

/** reducer が例外を投げて拒否する実装も「入れられない」とみなす */
const dispatchOrKeep = (state: AppState, next: AppState): AppState => {
  try {
    return reducer(state, { type: "replaceState", state: next });
  } catch {
    return state;
  }
};

describe("[@security] SEC-001 reducer の replaceState で検証・比較を迂回できない", () => {
  it("[@security] 検証を通らない状態（版番号が2だけのベースライン）を replaceState で入れられない", () => {
    const current = fixtureState();
    const bad = structuredClone(current);
    bad.baselines[0].version = 2; // v1 が無い・改版理由も無い
    expect(validateState(bad).ok).toBe(false); // 前提：検証では拒否される状態

    const result = dispatchOrKeep(current, bad);
    expect(result.baselines.map((b) => b.version)).toEqual([1]);
    expect(validateState(result).ok).toBe(true);
  });

  it("[@security] 確定済みのベースライン明細を書き換えた状態を replaceState で入れられない", () => {
    const current = fixtureState();
    const tampered = structuredClone(current);
    tampered.baselineItems[0].plannedHours = 999;
    expect(compareForImport(current, tampered).kind).toBe("replaces"); // 前提：比較では置き換えと判定される

    const result = dispatchOrKeep(current, tampered);
    expect(result.baselineItems).toEqual(current.baselineItems);
  });
});

describe("[@security] SEC-002 アプリが作った状態は次回の読み込みで拒否されない", () => {
  it("[@security] 監査ログの before/after に10,000文字を超えるJSONを記録しても、保存→読み込みで ok になる", () => {
    const state = fixtureState();
    const long = "あ".repeat(12_000);
    const next = appendAuditLog(
      state,
      { operator: "テスト太郎", targetType: "proposal", targetId: "proposal", action: "proposal.update", before: { background: long }, after: { background: `${long}改` } },
      new Date("2030-01-12T00:00:00.000Z"),
      () => "a2",
    );
    // 修正後は、長い値は上限内に切り詰めて記録する（元の前提「10,000文字を超えて記録される」は修正で成り立たなくなった）
    expect((next.auditLogs[1].after ?? "").length).toBeLessThanOrEqual(LIMITS.maxAuditPayloadLength);
    expect(next.auditLogs[1].after).toMatch(/省略/);

    const storage = new FakeStorage();
    expect(saveToStorage(storage, next).ok).toBe(true);
    const loaded = loadFromStorage(storage, new Date("2030-01-13T00:00:00.000Z"));
    expect(loaded.kind).toBe("ok");
  });
});

describe("[@security] SEC-003 壊れた保存データの退避が読み込みのたびに増えない", () => {
  it("[@security] 同じ壊れた値で2回起動しても、退避は1件のまま", () => {
    const storage = new FakeStorage();
    storage.setItem(STORAGE_KEY, '{"schemaVersion":1,"broken":true}');
    expect(loadFromStorage(storage, new Date("2030-01-12T00:00:00.000Z")).kind).toBe("corrupt");
    expect(loadFromStorage(storage, new Date("2030-01-12T00:05:00.000Z")).kind).toBe("corrupt");
    expect(listCorruptBackups(storage)).toHaveLength(1);
  });
});

describe("[@security] SEC-004 危険なキーは移行（migrate）の前に拒否する", () => {
  afterEach(() => {
    vi.doUnmock("./types");
    vi.resetModules();
  });

  const textWithProto = (): string =>
    fixtureText().replace('"schemaVersion":1,', '"schemaVersion":1,"__proto__":{"polluted":true},');

  it("[@security] schemaVersion:1 と __proto__ を含むJSONは「使えない項目名」で拒否される", () => {
    const r = parseStateText(textWithProto());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join("\n")).toContain("使えない項目名");
  });

  it("[@security] 移行が必要な版（現在の版が2のとき）でも、移行より先に「使えない項目名」で拒否される", async () => {
    // 版1のデータが migrate を通る状況を再現する（版1→2の移行関数より先に、危険な項目名で拒否されることを確かめる）
    vi.resetModules();
    vi.doMock("./types", async (importOriginal) => ({ ...(await importOriginal<object>()), CURRENT_SCHEMA_VERSION: 2 }));
    const mod = await import("./persistence");
    const r = mod.parseStateText(textWithProto());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join("\n")).toContain("使えない項目名");
  });
});

describe("[@security] SEC-005 監査ログの日時は時刻として比べる", () => {
  const withTwoLogs = (firstAt: string, secondAt: string): Rec => {
    const raw = fixtureRaw();
    const logs = listOf(raw, "auditLogs");
    logs[0].at = firstAt;
    logs.push({ ...logs[0], id: "a2", seq: 2, at: secondAt, targetType: "proposal", targetId: "proposal", action: "proposal.update" });
    return raw;
  };

  it("[@security] 08:00:00Z の次に 08:00:00.500Z（時刻は後）のログは受け入れる", () => {
    const r = validateState(withTwoLogs("2030-01-11T08:00:00Z", "2030-01-11T08:00:00.500Z"));
    expect(r.ok ? [] : r.errors).toEqual([]);
  });

  it("[@security] 08:00:00.500Z の次に 08:00:00Z（時刻は前）のログは拒否する", () => {
    expect(validateState(withTwoLogs("2030-01-11T08:00:00.500Z", "2030-01-11T08:00:00Z")).ok).toBe(false);
  });
});

describe("[@security] SEC-006 ベースライン明細・ゲート審査の整合性と、読み込み時の比較", () => {
  it("[@security] (1) 同じベースライン内で同じWBS要素の明細が重複していたら拒否する", () => {
    const raw = fixtureRaw();
    const items = listOf(raw, "baselineItems");
    items.push({ ...items[0], id: "bi2" });
    expect(validateState(raw).ok).toBe(false);
  });

  it("[@security] (2) 対象外のWPを参照する明細は拒否する", () => {
    const raw = fixtureRaw();
    const items = listOf(raw, "baselineItems");
    items.push({ ...items[0], id: "bi2", wbsNodeId: "n3" });
    expect(validateState(raw).ok).toBe(false);
  });

  it("[@security] (2) phase を参照する明細は拒否する", () => {
    const raw = fixtureRaw();
    const items = listOf(raw, "baselineItems");
    items.push({ ...items[0], id: "bi2", wbsNodeId: "n1" });
    expect(validateState(raw).ok).toBe(false);
  });

  it("[@security] (3) 差戻し（returned）なのに baselineId がある GateReview は拒否する", () => {
    const raw = fixtureRaw();
    const reviews = listOf(raw, "gateReviews");
    reviews.push({ ...reviews[0], id: "g2", decision: "returned", baselineId: "b1" });
    expect(validateState(raw).ok).toBe(false);
  });

  it("[@security] (3) 承認（approved）なのに baselineId が無い GateReview は拒否する", () => {
    const raw = fixtureRaw();
    listOf(raw, "gateReviews")[0].baselineId = null;
    expect(validateState(raw).ok).toBe(false);
  });

  it("[@security] (4) 現在の gateReviews を欠いたデータは replaces と判定する", () => {
    const current = fixtureState();
    const incoming = structuredClone(current);
    incoming.gateReviews = [];
    expect(compareForImport(current, incoming).kind).toBe("replaces");
  });

  it("[@security] (4) 現在の gateReviews を書き換えたデータは replaces と判定する", () => {
    const current = fixtureState();
    const incoming = structuredClone(current);
    incoming.gateReviews[0].reviewer = "別の人";
    incoming.gateReviews[0].comment = "書き換えた";
    expect(compareForImport(current, incoming).kind).toBe("replaces");
  });

  it("[@security] (5) 既存の版（b1）に明細を足しただけのデータは replaces と判定する", () => {
    const current = fixtureState();
    const raw = fixtureRaw();
    const nodes = listOf(raw, "wbsNodes");
    nodes.push({ ...nodes[1], id: "n4", code: "1.3", name: "テスト作業2" });
    listOf(raw, "objectiveTraces").push({ id: "t2", objectiveId: "o1", wbsNodeId: "n4", contribution: "テスト用" });
    const items = listOf(raw, "baselineItems");
    items.push({ ...items[0], id: "bi2", wbsNodeId: "n4", plannedHours: 5 });
    const parsed = validateState(raw);
    expect(parsed.ok ? [] : parsed.errors).toEqual([]); // 前提：形としては正しいデータ
    if (!parsed.ok) return;
    expect(compareForImport(current, parsed.state).kind).toBe("replaces");
  });
});
