import { describe, expect, it } from "vitest";
import {
  clearStorage,
  compareForImport,
  exportFileName,
  loadFromStorage,
  migrate,
  parseStateText,
  saveToStorage,
  serializeState,
  STORAGE_KEY,
  summarize,
} from "./persistence";
import { FakeStorage } from "./fakeStorage";
import { fixtureText } from "./testState";
import { createInitialState, type AppState } from "./types";

const fixtureState = (): AppState => {
  const r = parseStateText(fixtureText());
  if (!r.ok) throw new Error(r.errors.join());
  return r.state;
};
const now = new Date("2030-01-12T00:00:00.000Z");

describe("JSONの書き出しと読み込み", () => {
  it("書き出して読み込むと元に戻る", () => {
    const state = fixtureState();
    expect(parseStateText(serializeState(state))).toEqual({ ok: true, state });
  });

  it("1週目の形のJSON（素材）を読み込める（以降の週の回帰テスト）", () => {
    expect(parseStateText(fixtureText()).ok).toBe(true);
  });

  it("ファイル名は pmpoc- で始まり、.gitignore で除外される", () => {
    expect(exportFileName(new Date(2030, 0, 11, 17, 30))).toBe("pmpoc-state-20300111-1730.json");
  });

  it("要約に案件名・最新の版・監査ログの件数を出す", () => {
    expect(summarize(fixtureState())).toEqual({
      projectName: "テスト案件A",
      latestBaselineVersion: 1,
      auditLogCount: 1,
      lastExportedAt: "2030-01-11T08:05:00.000Z",
    });
    expect(summarize(createInitialState()).latestBaselineVersion).toBeNull();
  });
});

describe("版の移行", () => {
  // 今は版1だけなので、移行先の版を引数で与えて仕組みを確かめる
  const migrations = {
    1: (r: Record<string, unknown>) => ({ ...r, schemaVersion: 2, added: "v2" }),
    2: (r: Record<string, unknown>) => ({ ...r, schemaVersion: 3 }),
  };

  it("移行関数を版の順に通し、移行先の版にする", () => {
    expect(migrate({ schemaVersion: 1 }, migrations, 3)).toEqual({ ok: true, value: { schemaVersion: 3, added: "v2" } });
  });

  it("今の版のデータはそのまま通す", () => {
    expect(migrate({ schemaVersion: 1 })).toEqual({ ok: true, value: { schemaVersion: 1 } });
  });

  it("移行の方法が無い版は、理由を付けて拒否する", () => {
    const result = migrate({ schemaVersion: 1 }, {}, 2);
    expect(result).toEqual({ ok: false, error: "版1からの移行の方法がありません" });
  });

  it("版を上げ忘れた移行関数でも無限ループにならず拒否する", () => {
    const result = migrate({ schemaVersion: 1 }, { 1: (r) => r }, 2);
    expect(result.ok).toBe(false);
  });

  it("新しい版のデータは、アプリの更新を促して拒否する", () => {
    const result = migrate({ schemaVersion: 2 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/新しい版/);
  });
});

describe("localStorage", () => {
  it("保存したものを読み込める", () => {
    const storage = new FakeStorage();
    const state = fixtureState();
    expect(saveToStorage(storage, state)).toEqual({ ok: true });
    expect(loadFromStorage(storage, now)).toEqual({ kind: "ok", state });
  });

  it("何も保存されていなければ empty", () => {
    expect(loadFromStorage(new FakeStorage(), now)).toEqual({ kind: "empty" });
  });

  it("書き込みに失敗したら、理由を返す（例外を投げない）", () => {
    const storage = new FakeStorage();
    storage.failWrites = true;
    const result = saveToStorage(storage, createInitialState());
    expect(result.ok).toBe(false);
  });

  it("消去は、このアプリの名前空間のキーだけを消す", () => {
    const storage = new FakeStorage();
    storage.setItem(STORAGE_KEY, "x");
    storage.setItem("production_system_sim:theme", "dark");
    clearStorage(storage);
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
    expect(storage.getItem("production_system_sim:theme")).toBe("dark");
  });
});

describe("読み込み時の比較（追記のみ）", () => {
  it("初期状態からの読み込みは追記だけ", () => {
    expect(compareForImport(createInitialState(), fixtureState())).toEqual({ kind: "appendOnly" });
  });

  it("同じデータに監査ログを足したものは追記だけ", () => {
    const current = fixtureState();
    const incoming = structuredClone(current);
    incoming.auditLogs.push({ ...incoming.auditLogs[0], id: "a2", seq: 2 });
    expect(compareForImport(current, incoming)).toEqual({ kind: "appendOnly" });
  });
});
