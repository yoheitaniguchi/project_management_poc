// 保存と読み込みのセキュリティテスト（docs/security/checklist.md D・E。PR-Cの計画レビュー PLAN-SEC-001・002）
import { describe, expect, it } from "vitest";
import { compareForImport, loadFromStorage, parseStateText, STORAGE_KEY } from "./persistence";
import { FakeStorage } from "./fakeStorage";
import { fixtureText } from "./testState";
import { createInitialState, type AppState } from "./types";

const fixtureState = (): AppState => {
  const r = parseStateText(fixtureText());
  if (!r.ok) throw new Error(r.errors.join());
  return r.state;
};
const now = new Date("2030-01-12T00:00:00.000Z");

describe("[@security] 壊れた保存データで起動しても上書きしない", () => {
  it("[@security] 不正な値で起動すると corrupt になり、元の値は残ったうえで別のキーに退避される", () => {
    const storage = new FakeStorage();
    storage.setItem(STORAGE_KEY, '{"schemaVersion":1,"broken":true}');
    const result = loadFromStorage(storage, now);
    expect(result.kind).toBe("corrupt");
    if (result.kind !== "corrupt") return;
    expect(storage.getItem(STORAGE_KEY)).toBe('{"schemaVersion":1,"broken":true}');
    expect(result.backupKey).not.toBeNull();
    expect(storage.getItem(result.backupKey ?? "")).toBe('{"schemaVersion":1,"broken":true}');
  });

  it("[@security] JSONとして読めない値でも例外を投げず corrupt になる", () => {
    const storage = new FakeStorage();
    storage.setItem(STORAGE_KEY, "{not json");
    expect(loadFromStorage(storage, now).kind).toBe("corrupt");
  });

  it("[@security] 保存領域を読めないときも corrupt（自動保存を止める側）になる", () => {
    const storage = new FakeStorage();
    storage.failReads = true;
    expect(loadFromStorage(storage, now).kind).toBe("corrupt");
  });
});

describe("[@security] JSONの読み込み", () => {
  it("[@security] 上限を超える大きさのファイルを拒否する", () => {
    const big = " ".repeat(5 * 1024 * 1024 + 1);
    const result = parseStateText(big);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/大きすぎます/);
  });

  it("[@security] JSONとして読めないときは、生の例外文言ではなく日本語の理由を返す", () => {
    const result = parseStateText("{oops");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual(["JSONとして読めません。このアプリで書き出したファイルか確認してください"]);
    }
  });

  it("[@security] 確定済みのベースライン明細を書き換えたデータは「置き換え」と判定する", () => {
    const current = fixtureState();
    const incoming = structuredClone(current);
    incoming.baselineItems[0].plannedHours = 999;
    const result = compareForImport(current, incoming);
    expect(result.kind).toBe("replaces");
  });

  it("[@security] 監査ログが欠けた（古い）データは「置き換え」と判定する", () => {
    const current = fixtureState();
    const older = { ...createInitialState(), project: current.project };
    const result = compareForImport(current, older);
    expect(result.kind).toBe("replaces");
    if (result.kind === "replaces") expect(result.reasons.join()).toMatch(/監査ログが1件少なくなります/);
  });
});
