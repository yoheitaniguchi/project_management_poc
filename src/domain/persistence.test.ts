import { describe, expect, it } from "vitest";
import { appendAuditLog } from "./auditLog";
import {
  clearStorage,
  compareForImport,
  exportFileName,
  listCorruptBackups,
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

  it("検証に通らない状態は保存しない（次回の起動で読めなくならないように）", () => {
    const storage = new FakeStorage();
    const bad = fixtureState();
    bad.baselineItems = [];
    const result = saveToStorage(storage, bad);
    expect(result.ok).toBe(false);
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("消去は、このアプリの名前空間のキー（壊れたデータの退避を含む）だけを消す", () => {
    const storage = new FakeStorage();
    storage.setItem(STORAGE_KEY, "{broken");
    loadFromStorage(storage, now);
    expect(listCorruptBackups(storage)).toHaveLength(1);
    storage.setItem("production_system_sim:theme", "dark");
    clearStorage(storage);
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
    expect(listCorruptBackups(storage)).toEqual([]);
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

  it("新しい版（v2）と、その明細・監査ログを足しただけなら追記だけ", () => {
    const current = fixtureState();
    const incoming = structuredClone(current);
    incoming.baselines.push({ ...incoming.baselines[0], id: "b2", version: 2, gate: "改版", revisionReason: "テスト" });
    incoming.baselineItems.push({ ...incoming.baselineItems[0], id: "bi2", baselineId: "b2" });
    incoming.auditLogs.push({ ...incoming.auditLogs[0], id: "a2", seq: 2, targetId: "b2", action: "baseline.revise" });
    expect(compareForImport(current, incoming)).toEqual({ kind: "appendOnly" });
  });

  it("キーの順序が違うだけなら同じ内容とみなす（アプリが作ったログと読み込んだログ）", () => {
    let n = 1;
    const current = appendAuditLog(fixtureState(), {
      operator: "テスト太郎", targetType: "proposal", targetId: "proposal", action: "proposal.update", before: null, after: { a: 1 },
    }, new Date("2030-01-12T00:00:00.000Z"), () => `a${++n}`);
    const reloaded = parseStateText(serializeState(current));
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    const reordered = structuredClone(reloaded.state);
    reordered.auditLogs = reordered.auditLogs.map((a) => Object.fromEntries(Object.entries(a).reverse()) as typeof a);
    expect(compareForImport(current, reordered)).toEqual({ kind: "appendOnly" });
  });

  it("確定済みのベースライン本体の変更・並び替え・スナップショットの減少は置き換え", () => {
    const current = fixtureState();
    const changed = structuredClone(current);
    changed.baselines[0].comment = "書き換え";
    expect(compareForImport(current, changed).kind).toBe("replaces");

    const twoLogs = appendAuditLog(current, {
      operator: "x", targetType: "proposal", targetId: "proposal", action: "proposal.update", before: null, after: null,
    }, new Date("2030-01-12T00:00:00.000Z"), () => "a2");
    const swapped = structuredClone(twoLogs);
    swapped.auditLogs.reverse();
    expect(compareForImport(twoLogs, swapped).kind).toBe("replaces");

    const withSnapshot = structuredClone(current);
    withSnapshot.evmSnapshots = [{
      id: "s1", baselineId: "b1", asOf: "2030-01-11", pv: 10, ev: 5, ac: 4, bac: 10,
      cpi: 1.25, spi: 0.5, eac: 8, consumptionRate: 0.4, progressRate: 0.5, createdAt: "2030-01-11T09:00:00.000Z",
    }];
    const result = compareForImport(withSnapshot, current);
    expect(result).toEqual({ kind: "replaces", reasons: ["週次スナップショットが1件少なくなります"] });
  });

  it("実績やWBSの件数が減るデータは、理由を付けて置き換えと判定する", () => {
    const current = fixtureState();
    const fewer = structuredClone(current);
    fewer.wbsNodes = fewer.wbsNodes.filter((n) => n.id !== "n3");
    const result = compareForImport(current, fewer);
    expect(result).toEqual({ kind: "replaces", reasons: ["WBS要素が1件少なくなります"] });
  });
});
