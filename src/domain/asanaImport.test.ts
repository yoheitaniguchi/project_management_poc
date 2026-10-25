// Asana のCSVの取込（差分方式。人間の判断 2026-10-25）。テストには、テスト用に作ったCSVだけを使う（実データは使わない。6.2）
import { describe, expect, it } from "vitest";
import { importAsanaCsv, parseAsanaDuration } from "./asanaImport";
import { confirmBaseline, reviseBaseline } from "./baseline";
import { setCompleted } from "./completion";
import { computeEvm } from "./evm";
import { importManualCsv } from "./timeImport";
import { migrate, parseStateText, serializeState } from "./persistence";
import type { OpResult } from "./proposal";
import { addMember, addObjective, updateMember } from "./proposal";
import { expectValidState, fixtureRaw } from "./testState";
import { createInitialState, type AppState } from "./types";
import { validateState } from "./validate";
import { expandTemplate, setEstimate, setExcluded, setTrace, targetWorkPackages, updateNode } from "./wbs";

const ids = () => {
  let n = 0;
  return () => `id${++n}`;
};
const okState = (r: OpResult): AppState => {
  if (!r.ok) throw new Error(r.error);
  expectValidState(r.state);
  return r.state;
};
const at = (day: number, hour = 18, month = 9) => new Date(2026, month, day, hour, 0);

/** 計画（v1、合意日 10/26）：設計 10時間（10/26〜10/30）、開発 6時間（10/29〜11/03）。ほかは対象外。BAC 16時間 */
function planned() {
  const id = ids();
  let s = okState(addMember(createInitialState(), "pm", at(26), id));
  s = okState(updateMember(s, s.members[0].id, { name: "PM" }));
  s = okState(addObjective(s, id));
  s = okState(expandTemplate(s, id));
  const plan: Record<string, [number, string, string]> = { 設計: [10, "2026-10-26", "2026-10-30"], 開発: [6, "2026-10-29", "2026-11-03"] };
  for (const n of targetWorkPackages(s)) {
    const p = plan[n.name];
    if (!p) {
      s = okState(setExcluded(s, n.id, true, "例では使わない"));
      continue;
    }
    s = okState(setTrace(s, n.id, s.objectives[0].id, true, id));
    s = okState(setEstimate(s, n.id, { hours: p[0], basis: "" }, id));
    s = okState(updateNode(s, n.id, { plannedStart: p[1], plannedEnd: p[2] }));
  }
  s = okState(confirmBaseline(s, { approver: "監理者", approvedOn: "2026-10-26", comment: "" }, at(26), id));
  const node = (name: string) => s.wbsNodes.find((x) => x.name === name)!;
  return { s, id, A: node("設計"), B: node("開発"), X: node("テスト") };
}

type Row = { gid: string; name: string; completedAt?: string; actual?: string };
/** Asana の書き出しに似せたCSV（BOM付き、列の並びは Asana と同じ。メモは複数行） */
const asanaCsv = (rows: Row[]) =>
  "﻿Task ID,Created At,Completed At,Last Modified,Name,Section/Column,Notes,Projects,Estimated time,Actual time\n" +
  rows.map((r) => `"${r.gid}",2026-10-25,${r.completedAt ?? ""},2026-10-25,${r.name},設計・開発,"作業区分：機能\n見積工数：5時間",テスト,,${r.actual ?? ""}`).join("\n") +
  "\n";

const ok = (o: ReturnType<typeof importAsanaCsv>) => {
  expect(o.errors).toEqual([]);
  expectValidState(o.state);
  return o;
};

describe("parseAsanaDuration：時間:分", () => {
  it("空は0、時間:分は分にする。それ以外は読めない", () => {
    expect([parseAsanaDuration(""), parseAsanaDuration("5:00"), parseAsanaDuration("12:30"), parseAsanaDuration(" 0:05 ")]).toEqual([0, 300, 750, 5]);
    for (const bad of ["5", "5.5", "5:60", "-1:00", "1:5", "a:00"]) expect(parseAsanaDuration(bad)).toBeNull();
  });
});

describe("importAsanaCsv：差分方式で実績を取り込む", () => {
  it("初回：タスク名の先頭のWBSコードで照合してタスクGIDを記録し、累計を実績にする（作業日はCSVを書き出した日）", () => {
    const { s, id, A, B } = planned();
    const o = ok(importAsanaCsv(s, "asana.csv", asanaCsv([{ gid: "101", name: `${A.code} 設計`, actual: "3:30" }, { gid: "102", name: `${B.code} 開発` }]), "2026-10-27", at(27), id));
    expect([o.result, o.added, o.skipped, o.linked]).toEqual(["success", 1, 0, 2]);
    expect(o.state.wbsNodes.find((n) => n.id === A.id)?.asanaTaskGid).toBe("101");
    expect(o.state.timeEntries).toEqual([
      { id: expect.any(String), wbsNodeId: A.id, memberId: s.members[0].id, workDate: "2026-10-27", minutes: 210, source: "asana_csv", uniqueKey: "asana_csv:101:210" },
    ]);
    expect(o.state.syncRuns.at(-1)).toMatchObject({ result: "success", count: 1, fileName: "asana.csv" });
    expect(computeEvm(o.state, "2026-10-27")?.ac).toBe(3.5);
  });

  it("同じファイルを取り込み直しても増えない（冪等）。累計が増えた分だけを新しい実績にする", () => {
    const { s, id, A } = planned();
    const csv1 = asanaCsv([{ gid: "101", name: `${A.code} 設計`, actual: "3:30" }]);
    const first = ok(importAsanaCsv(s, "a.csv", csv1, "2026-10-27", at(27), id)).state;
    const again = ok(importAsanaCsv(first, "a.csv", csv1, "2026-10-27", at(27, 19), id));
    expect([again.added, again.skipped]).toEqual([0, 1]);
    expect(again.state.timeEntries).toEqual(first.timeEntries);
    // 2回目の書き出し：累計 5:00 → 差分 1.5時間を 10/30 の実績にする。タスク名を変えても、タスクGIDで照合する
    const second = ok(importAsanaCsv(first, "b.csv", asanaCsv([{ gid: "101", name: "名前を変えたタスク", actual: "5:00" }]), "2026-10-30", at(30), id));
    expect(second.state.timeEntries.map((t) => [t.workDate, t.minutes, t.uniqueKey])).toEqual([
      ["2026-10-27", 210, "asana_csv:101:210"],
      ["2026-10-30", 90, "asana_csv:101:300"],
    ]);
    expect(computeEvm(second.state, "2026-10-30")?.ac).toBe(5);
  });

  it("累計が前回より減っていたら、何も取り込まず失敗として記録する", () => {
    const { s, id, A, B } = planned();
    const first = ok(importAsanaCsv(s, "a.csv", asanaCsv([{ gid: "101", name: `${A.code} 設計`, actual: "5:00" }]), "2026-10-27", at(27), id)).state;
    const o = importAsanaCsv(first, "b.csv", asanaCsv([{ gid: "101", name: `${A.code} 設計`, actual: "4:00" }, { gid: "102", name: `${B.code} 開発`, actual: "1:00" }]), "2026-10-30", at(30), id);
    expect(o.result).toBe("failure");
    expect(o.errors.join("\n")).toMatch(/2行目：.*累計（4時間）が、前回までに取り込んだ累計（5時間）より減っています/);
    expect(o.state.timeEntries).toEqual(first.timeEntries);
    expect(o.state.wbsNodes).toEqual(first.wbsNodes); // 開発のタスクGIDも記録しない（一部だけを取り込まない）
    expect(o.state.syncRuns.at(-1)).toMatchObject({ result: "failure", count: 0 });
    expectValidState(o.state);
  });

  it("CSVを書き出した日：未入力・未来・v1の合意日より前・前回の取込より前は受け付けない", () => {
    const { s, id, A } = planned();
    const csv = (actual: string) => asanaCsv([{ gid: "101", name: `${A.code} 設計`, actual }]);
    expect(importAsanaCsv(s, "a.csv", csv("1:00"), "", at(27), id).errors).toEqual(["CSVを書き出した日を入力してください"]);
    expect(importAsanaCsv(s, "a.csv", csv("1:00"), "2026-10-28", at(27), id).errors[0]).toMatch(/未来/);
    expect(importAsanaCsv(s, "a.csv", csv("1:00"), "2026-10-25", at(27), id).errors[0]).toMatch(/合意日（2026-10-26）より前/);
    const first = ok(importAsanaCsv(s, "a.csv", csv("1:00"), "2026-10-28", at(28), id)).state;
    expect(importAsanaCsv(first, "b.csv", csv("2:00"), "2026-10-27", at(29), id).errors.join("\n")).toMatch(/前回の取込（2026-10-28）より前/);
  });

  it("対応するWPが無いタスク：実績が無ければ飛ばして警告、実績があれば誤り", () => {
    const { s, id, A } = planned();
    const skip = ok(importAsanaCsv(s, "a.csv", asanaCsv([{ gid: "101", name: `${A.code} 設計`, actual: "1:00" }, { gid: "109", name: "9.9 別の作業" }]), "2026-10-27", at(27), id));
    // メモが2行あるので、2つ目のタスクはファイルの4行目から始まる
    expect(skip.warnings).toEqual([expect.stringMatching(/^4行目：対応するWPが無いため飛ばしました/)]);
    const bad = importAsanaCsv(s, "a.csv", asanaCsv([{ gid: "109", name: "9.9 別の作業", actual: "1:00" }]), "2026-10-27", at(27), id);
    expect(bad.errors.join("\n")).toMatch(/2行目：対応するWPがありません（タスク名の先頭のWBSコード「9.9」/);
  });

  it("フェーズ・最初から対象外のWP・別のタスクに対応付け済みのWP・同じWPを指す2行は、実績があれば誤り", () => {
    const { s, id, A, X } = planned();
    const phase = s.wbsNodes.find((n) => n.kind === "phase")!;
    const err = (rows: Row[], from = s) => importAsanaCsv(from, "a.csv", asanaCsv(rows), "2026-10-27", at(27), id).errors.join("\n");
    expect(err([{ gid: "201", name: `${phase.code} フェーズ`, actual: "1:00" }])).toMatch(/フェーズです/);
    expect(err([{ gid: "202", name: `${X.code} テスト`, actual: "1:00" }])).toMatch(/対象外のWPです/);
    expect(err([{ gid: "101", name: `${A.code} 設計`, actual: "1:00" }, { gid: "102", name: `${A.code} 設計の続き`, actual: "1:00" }])).toMatch(/2行目と同じWP/);
    expect(err([{ gid: "101", name: `${A.code} 設計` }, { gid: "101", name: `${A.code} 設計` }])).toMatch(/2行目と同じタスクです/);
    const linked = ok(importAsanaCsv(s, "a.csv", asanaCsv([{ gid: "101", name: `${A.code} 設計` }]), "2026-10-27", at(27), id)).state;
    expect(err([{ gid: "999", name: `${A.code} 設計`, actual: "1:00" }], linked)).toMatch(/別のAsanaタスク（101）に対応付け済み/);
  });

  it("列が足りない・時間や日付の書き方が違う・タスクIDが数字でないファイルは取り込まない", () => {
    const { s, id, A } = planned();
    expect(importAsanaCsv(s, "a.csv", "Task ID,Name\n1,x\n", "2026-10-27", at(27), id).errors[0]).toMatch(/列「Completed At」・「Actual time」がありません/);
    const err = (row: Row) => importAsanaCsv(s, "a.csv", asanaCsv([row]), "2026-10-27", at(27), id).errors.join("\n");
    expect(err({ gid: "101", name: `${A.code} 設計`, actual: "1.5" })).toMatch(/時間:分/);
    expect(err({ gid: "101", name: `${A.code} 設計`, completedAt: "10/27/2026" })).toMatch(/日付（YYYY-MM-DD）/);
    expect(err({ gid: "=cmd", name: `${A.code} 設計` })).toMatch(/数字ではありません/);
  });

  it("手入力のCSVの実績もあるWPには、二重になっていないかの警告を出す", () => {
    const { s, id, A } = planned();
    const manual = importManualCsv(s, "m.csv", `作業日,WBSコード,時間,メモ\n2026-10-26,${A.code},1,\n`, at(27), id);
    expect(manual.result).toBe("success");
    const o = ok(importAsanaCsv(manual.state, "a.csv", asanaCsv([{ gid: "101", name: `${A.code} 設計`, actual: "1:00" }]), "2026-10-27", at(27), id));
    expect(o.warnings.join("\n")).toMatch(/手入力のCSVの実績もあります/);
  });

  it("実績も完了も無い行は、別のタスクに対応付け済みのWP・同じWPを指す2行目でも、飛ばして警告する", () => {
    const { s, id, A } = planned();
    const linked = ok(importAsanaCsv(s, "a.csv", asanaCsv([{ gid: "101", name: `${A.code} 設計`, actual: "1:00" }]), "2026-10-27", at(27), id)).state;
    const copy = ok(importAsanaCsv(linked, "b.csv", asanaCsv([{ gid: "101", name: `${A.code} 設計`, actual: "1:00" }, { gid: "103", name: `${A.code} 設計（複製）` }]), "2026-10-28", at(28), id));
    expect(copy.warnings.join("\n")).toMatch(/別のAsanaタスクに対応付け済みのため飛ばしました/);
    const dup = ok(importAsanaCsv(s, "a.csv", asanaCsv([{ gid: "101", name: `${A.code} 設計`, actual: "1:00" }, { gid: "102", name: `${A.code} 設計のメモ` }]), "2026-10-27", at(27), id));
    expect(dup.warnings.join("\n")).toMatch(/同じWP（.*）を指しているため飛ばしました/);
  });

  it("改版で外した（対象外の）WP：実績は取り込み、Asana の完了は取り込まずに警告する", () => {
    const { s, id, A, B } = planned();
    const v2 = okState(reviseBaseline(s, { approver: "監理者", approvedOn: "2026-10-27", comment: "", revisionReason: "開発を外す", exclusions: [{ wbsNodeId: B.id, reason: "範囲外" }] }, at(27), id));
    const o = ok(importAsanaCsv(v2, "a.csv", asanaCsv([{ gid: "101", name: `${A.code} 設計`, actual: "1:00" }, { gid: "102", name: `${B.code} 開発`, completedAt: "2026-10-28", actual: "2:00" }]), "2026-10-29", at(29), id));
    expect(o.added).toBe(2);
    expect(o.completed).toBe(0);
    expect(o.state.wbsNodes.find((n) => n.id === B.id)?.completedOn).toBeNull();
    expect(o.warnings.join("\n")).toMatch(/対象外のWPのため、Asana の完了は取り込みませんでした/);
    expect(computeEvm(o.state, "2026-10-29")?.ac).toBe(3); // 外したWPの実績も AC に含める（5章）
  });

  it("Asana の後に手入力のCSVを取り込むと、二重になっていないかの警告を出す", () => {
    const { s, id, A } = planned();
    const st = ok(importAsanaCsv(s, "a.csv", asanaCsv([{ gid: "101", name: `${A.code} 設計`, actual: "1:00" }]), "2026-10-27", at(27), id)).state;
    const manual = importManualCsv(st, "m.csv", `作業日,WBSコード,時間,メモ\n2026-10-26,${A.code},1,\n`, at(27), id);
    expect(manual.result).toBe("success");
    expect(manual.warnings.join("\n")).toMatch(/Asana から取り込んだ実績もあります/);
  });

  it("取り込んだ後の状態は、JSONに書き出して読み込むと元に戻る", () => {
    const { s, id, A } = planned();
    const st = ok(importAsanaCsv(s, "a.csv", asanaCsv([{ gid: "101", name: `${A.code} 設計`, completedAt: "2026-10-28", actual: "2:00" }]), "2026-10-29", at(29), id)).state;
    const parsed = parseStateText(serializeState(st));
    expect(parsed.ok && parsed.state).toEqual(st);
  });

  it("1回の差分が24時間を超えても受け付ける（作業日ごとの明細ではないため）", () => {
    const { s, id, A } = planned();
    const o = ok(importAsanaCsv(s, "a.csv", asanaCsv([{ gid: "101", name: `${A.code} 設計`, actual: "30:00" }]), "2026-10-30", at(30), id));
    expect(o.state.timeEntries[0].minutes).toBe(1800);
  });
});

describe("importAsanaCsv：完了状態（Asana の完了を手動の設定より優先する）", () => {
  it("Asana で完了ならその完了日で完了にし、出どころを Asana として監査ログに残す", () => {
    const { s, id, A } = planned();
    const o = ok(importAsanaCsv(s, "a.csv", asanaCsv([{ gid: "101", name: `${A.code} 設計`, completedAt: "2026-10-28", actual: "2:00" }]), "2026-10-29", at(29), id));
    expect(o.completed).toBe(1);
    expect(o.state.wbsNodes.find((n) => n.id === A.id)).toMatchObject({ completedOn: "2026-10-28", completionSource: "asana" });
    expect(o.state.auditLogs.at(-1)).toMatchObject({ action: "wbs.complete", targetId: A.id });
    expect(JSON.parse(o.state.auditLogs.at(-1)?.after ?? "{}")).toMatchObject({ completedOn: "2026-10-28", source: "asana" });
    expect(computeEvm(o.state, "2026-10-28")?.ev).toBe(10);
  });

  it("手動の完了があっても、Asana の完了日で上書きする。Asana で未完了なら、手動の完了は残す", () => {
    const { s, id, A, B } = planned();
    let st = okState(setCompleted(s, A.id, "2026-10-27", at(27), id));
    st = okState(setCompleted(st, B.id, "2026-10-28", at(28), id));
    const o = ok(importAsanaCsv(st, "a.csv", asanaCsv([{ gid: "101", name: `${A.code} 設計`, completedAt: "2026-10-28" }, { gid: "102", name: `${B.code} 開発` }]), "2026-10-29", at(29), id));
    expect(o.state.wbsNodes.find((n) => n.id === A.id)).toMatchObject({ completedOn: "2026-10-28", completionSource: "asana" });
    expect(o.state.wbsNodes.find((n) => n.id === B.id)).toMatchObject({ completedOn: "2026-10-28", completionSource: "manual" });
  });

  it("前回 Asana の完了として取り込んだWPが Asana で未完了に戻っていれば、完了を取り消す。同じファイルの再取込では何も変えない", () => {
    const { s, id, A } = planned();
    const done = asanaCsv([{ gid: "101", name: `${A.code} 設計`, completedAt: "2026-10-28" }]);
    const first = ok(importAsanaCsv(s, "a.csv", done, "2026-10-29", at(29), id)).state;
    const again = ok(importAsanaCsv(first, "a.csv", done, "2026-10-29", at(29, 19), id));
    expect([again.completed, again.reopened]).toEqual([0, 0]);
    expect(again.state.auditLogs).toEqual(first.auditLogs);
    const reopened = ok(importAsanaCsv(first, "b.csv", asanaCsv([{ gid: "101", name: `${A.code} 設計` }]), "2026-10-30", at(30), id));
    expect(reopened.reopened).toBe(1);
    expect(reopened.state.wbsNodes.find((n) => n.id === A.id)).toMatchObject({ completedOn: null, completionSource: null });
    expect(reopened.warnings.join("\n")).toMatch(/未完了に戻っていたため、完了を取り消しました/);
  });

  it("未来の完了日は受け付けない", () => {
    const { s, id, A } = planned();
    expect(importAsanaCsv(s, "a.csv", asanaCsv([{ gid: "101", name: `${A.code} 設計`, completedAt: "2026-10-31" }]), "2026-10-29", at(29), id).errors.join("\n")).toMatch(/完了日が未来/);
  });
});

describe("[@security] 読み込み時の検証：Asana の実績と完了の出どころ", () => {
  function imported() {
    const { s, id, A } = planned();
    let st = ok(importAsanaCsv(s, "a.csv", asanaCsv([{ gid: "101", name: `${A.code} 設計`, actual: "2:00" }]), "2026-10-27", at(27), id)).state;
    st = ok(importAsanaCsv(st, "b.csv", asanaCsv([{ gid: "101", name: `${A.code} 設計`, completedAt: "2026-10-29", actual: "3:00" }]), "2026-10-30", at(30), id)).state;
    return { st, A };
  }
  const errorsOf = (s: AppState) => {
    const r = validateState(s);
    return r.ok ? "" : r.errors.join("\n");
  };

  it("[@security] 実績の工数を書き換えると、累計の差と合わないので拒否する", () => {
    const { st } = imported();
    const c = structuredClone(st);
    c.timeEntries[1].minutes = 600;
    expect(errorsOf(c)).toMatch(/Asanaの実績の工数が累計の差と合いません/);
  });

  it("[@security] 一意キーの形式・WPのタスクGIDと合わない・作業日の逆転・タスクGIDの重複を拒否する", () => {
    const { st, A } = imported();
    const key = structuredClone(st);
    key.timeEntries[0].uniqueKey = "asana_csv:101:abc";
    expect(errorsOf(key)).toMatch(/一意キーの形式が正しくありません/);
    const gid = structuredClone(st);
    gid.wbsNodes = gid.wbsNodes.map((n) => (n.id === A.id ? { ...n, asanaTaskGid: "555" } : n));
    expect(errorsOf(gid)).toMatch(/WPのAsanaタスクGIDと一意キーが合いません/);
    const order = structuredClone(st);
    order.timeEntries[1].workDate = "2026-10-26";
    expect(errorsOf(order)).toMatch(/作業日が前の取込より前です/);
    const dup = structuredClone(st);
    const other = dup.wbsNodes.find((n) => n.kind === "work_package" && n.id !== A.id)!;
    dup.wbsNodes = dup.wbsNodes.map((n) => (n.id === other.id ? { ...n, asanaTaskGid: "101" } : n));
    expect(errorsOf(dup)).toMatch(/AsanaタスクGID「101」が重複しています/);
  });

  it("[@security] 完了の出どころを書き換えると、監査ログの記録と合わないので拒否する", () => {
    const { st, A } = imported();
    const c = structuredClone(st);
    c.wbsNodes = c.wbsNodes.map((n) => (n.id === A.id ? { ...n, completionSource: "manual" as const } : n));
    expect(errorsOf(c)).toMatch(/完了の出どころが監査ログの記録と合いません/);
  });
});

describe("版3 → 4 の移行", () => {
  it("WBS要素に完了の出どころを足す。版3までの完了は手動とする", () => {
    const raw = { ...fixtureRaw(), schemaVersion: 3 } as Record<string, unknown>;
    const nodes = raw.wbsNodes as Record<string, unknown>[];
    for (const n of nodes) delete n.completionSource;
    const r = migrate(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const migrated = (r.value as { wbsNodes: { completedOn: string | null; completionSource: string | null }[] }).wbsNodes;
    expect(migrated.every((n) => n.completionSource === (n.completedOn === null ? null : "manual"))).toBe(true);
    expect(validateState(r.value).ok).toBe(true);
  });

  it("完了のWPがある版3のファイルを読み込むと、監査ログとの照合まで通り、手動の完了になる", () => {
    const { s, id, A } = planned();
    const st = okState(setCompleted(s, A.id, "2026-10-27", at(27), id));
    const v3 = JSON.parse(serializeState(st)) as Record<string, unknown>;
    v3.schemaVersion = 3;
    for (const n of v3.wbsNodes as Record<string, unknown>[]) delete n.completionSource;
    const parsed = parseStateText(JSON.stringify(v3));
    expect(parsed.ok ? [] : parsed.errors).toEqual([]);
    if (parsed.ok) expect(parsed.state.wbsNodes.find((n) => n.id === A.id)).toMatchObject({ completedOn: "2026-10-27", completionSource: "manual" });
  });

  it("版3のWBS要素に知らない項目があれば移行しない", () => {
    const raw = { ...fixtureRaw(), schemaVersion: 3 } as Record<string, unknown>;
    const nodes = raw.wbsNodes as Record<string, unknown>[];
    for (const n of nodes) delete n.completionSource;
    nodes[0].extra = 1;
    expect(migrate(raw)).toEqual({ ok: false, error: expect.stringMatching(/版3のwbsNodes\[0\]に知らない項目「extra」/) });
  });
});
