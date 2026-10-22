import { describe, expect, it } from "vitest";
import { confirmBaseline, reviseBaseline } from "./baseline";
import { computeEvm } from "./evm";
import { frozenRecordChanges } from "./persistence";
import type { OpResult } from "./proposal";
import { addMember, addObjective, updateMember } from "./proposal";
import { expectValidState } from "./testState";
import { importManualCsv } from "./timeImport";
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
const CONFIRMED_AT = new Date(2026, 9, 26, 18, 0);
const NOW = new Date(2026, 9, 30, 18, 0); // 2026-10-30（金）

/** v1（合意日 2026-10-26）。設計（コード 2.1）・開発（2.2）だけが対象で、ほかは対象外 */
function confirmed() {
  const id = ids();
  let s = okState(addMember(createInitialState(), "pm", CONFIRMED_AT, id));
  s = okState(updateMember(s, s.members[0].id, { name: "PM" }));
  s = okState(addObjective(s, id));
  s = okState(expandTemplate(s, id));
  for (const n of targetWorkPackages(s)) {
    if (n.name !== "設計" && n.name !== "開発") {
      s = okState(setExcluded(s, n.id, true, "例では使わない"));
      continue;
    }
    s = okState(setTrace(s, n.id, s.objectives[0].id, true, id));
    s = okState(setEstimate(s, n.id, { hours: 8, basis: "" }, id));
    s = okState(updateNode(s, n.id, { plannedStart: "2026-10-26", plannedEnd: "2026-10-30" }));
  }
  s = okState(confirmBaseline(s, { approver: "監理者", approvedOn: "2026-10-26", comment: "" }, CONFIRMED_AT, id));
  return { s, id };
}
const code = (s: AppState, name: string) => s.wbsNodes.find((n) => n.name === name)?.code ?? "";
const csv = (...lines: string[]) => ["作業日,WBSコード,時間,メモ", ...lines].join("\n");

describe("実績のCSVの取込（manual_csv）", () => {
  it("取り込んだ行を分単位で保存し、PMの実績として記録し、取込履歴に成功を残す", () => {
    const { s: s0, id } = confirmed();
    const r = importManualCsv(s0, "actuals.csv", csv(`2026-10-26,${code(s0, "設計")},1.5,設計の打合せ`, `2026-10-27,${code(s0, "開発")},2,`), NOW, id);
    expect(r).toMatchObject({ result: "success", added: 2, skipped: 0, errors: [] });
    expectValidState(r.state);
    expect(r.state.timeEntries.map((t) => [t.workDate, t.minutes, t.source, t.memberId])).toEqual([
      ["2026-10-26", 90, "manual_csv", s0.members[0].id],
      ["2026-10-27", 120, "manual_csv", s0.members[0].id],
    ]);
    expect(r.state.syncRuns.at(-1)).toMatchObject({ fileName: "actuals.csv", result: "success", count: 2, error: null, importedAt: NOW.toISOString() });
    expect(frozenRecordChanges(s0, r.state)).toEqual([]);
    // EVM の AC に入る
    expect(computeEvm(r.state, "2026-10-30")?.ac).toBe(3.5);
  });

  it("同じファイルを再取込しても重複しない（冪等）。取込履歴には成功・0件を残す", () => {
    const { s: s0, id } = confirmed();
    const file = csv(`2026-10-26,${code(s0, "設計")},1.5,a`, `2026-10-26,${code(s0, "設計")},1,b`);
    const first = importManualCsv(s0, "a.csv", file, NOW, id).state;
    const again = importManualCsv(first, "a.csv", file, NOW, id);
    expect(again).toMatchObject({ result: "success", added: 0, skipped: 2 });
    expect(again.state.timeEntries).toHaveLength(2);
    expect(again.state.syncRuns.map((x) => [x.result, x.count])).toEqual([["success", 2], ["success", 0]]);
    // 前の期間に行を足したファイル：足した行だけを取り込む
    const more = importManualCsv(first, "b.csv", file + `\n2026-10-27,${code(s0, "設計")},2,c`, NOW, id);
    expect(more).toMatchObject({ added: 1, skipped: 2 });
  });

  it("取込済みと時間だけが違う行があれば、黙って上書きせず、ファイル全体を取り込まない", () => {
    const { s: s0, id } = confirmed();
    const first = importManualCsv(s0, "a.csv", csv(`2026-10-26,${code(s0, "設計")},1.5,a`), NOW, id).state;
    const r = importManualCsv(first, "a2.csv", csv(`2026-10-27,${code(s0, "設計")},1,new`, `2026-10-26,${code(s0, "設計")},2,a`), NOW, id);
    expect(r.result).toBe("failure");
    expect(r.errors).toEqual([expect.stringMatching(/^3行目：取込済みの実績（1.5時間）と時間が違います/)]);
    expect(r.state.timeEntries).toEqual(first.timeEntries);
    expect(r.state.syncRuns.at(-1)).toMatchObject({ result: "failure", count: 0, error: expect.stringMatching(/3行目/) });
    expectValidState(r.state);
  });

  it("1行でも誤りがあれば何も取り込まず、すべての誤りを行番号付きで示す", () => {
    const { s: s0, id } = confirmed();
    const design = code(s0, "設計");
    const phase = s0.wbsNodes.find((n) => n.kind === "phase")?.code ?? "";
    const excluded = s0.wbsNodes.find((n) => n.name === "テスト")?.code ?? "";
    const r = importManualCsv(
      s0,
      "bad.csv",
      csv(
        `2026-10-26,${design},1,ok`,
        `2026-10-25,${design},1,PoC開始前`,
        `2026-10-31,${design},1,未来`,
        `2026/10/27,${design},1,形式`,
        `2026-10-27,9.9,1,不明`,
        `2026-10-27,${phase},1,フェーズ`,
        `2026-10-27,${excluded},1,対象外`,
        `2026-10-27,${design},0,0時間`,
        `2026-10-27,${design},0.3,刻み`,
        `2026-10-27,${design},25,多すぎ`,
        `2026-10-27,${design},abc,文字`,
        `2026-10-27,${design},-1,負`,
        `2026-10-27,${design},1`,
        `2026-10-26,${design},1,ok`,
        `2026-10-27,${design},1,${"あ".repeat(501)}`,
      ),
      NOW,
      id,
    );
    expect(r.result).toBe("failure");
    expect(r.state.timeEntries).toEqual([]);
    expect(r.errors.map((e) => e.split("：")[0])).toEqual(["3行目", "4行目", "5行目", "6行目", "7行目", "8行目", "9行目", "10行目", "11行目", "12行目", "13行目", "14行目", "15行目", "16行目"]);
    expect(r.errors.join("\n")).toMatch(/合意日（2026-10-26）より前/);
    expect(r.errors.join("\n")).toMatch(/2行目と同じ作業日・WBSコード・メモ/);
    expectValidState(r.state);
  });

  it("見出しが違う・行が無い・v1 が無い・PM がいないときは取り込まない", () => {
    const { s: s0, id } = confirmed();
    expect(importManualCsv(s0, "x.csv", "日付,コード,時間,メモ\n2026-10-26,2.1,1,", NOW, id).errors[0]).toMatch(/見出し/);
    expect(importManualCsv(s0, "x.csv", csv(), NOW, id).errors[0]).toMatch(/行がありません/);
    expect(importManualCsv(createInitialState(), "x.csv", csv("2026-10-26,2.1,1,"), NOW, id).errors[0]).toMatch(/ベースラインv1/);
    const noPm = { ...s0, members: [], projectMembers: [], project: { ...s0.project, pmMemberId: null } };
    expect(importManualCsv(noPm, "x.csv", csv("2026-10-26,2.1,1,"), NOW, id).errors[0]).toMatch(/PM/);
  });

  it("ベースラインの後に足したWP、改版で外したWPの実績は受け付ける", () => {
    const { s: s0, id } = confirmed();
    const design = s0.wbsNodes.find((n) => n.name === "設計");
    let s = okState(reviseBaseline(s0, { approver: "監理者", approvedOn: "2026-10-27", comment: "", revisionReason: "開発を外す", exclusions: [{ wbsNodeId: s0.wbsNodes.find((n) => n.name === "開発")?.id ?? "", reason: "範囲外" }] }, NOW, id));
    s = okState(addWorkPackage(s, design?.parentId ?? "", () => "added-wp"));
    const added = s.wbsNodes.find((n) => n.id === "added-wp")?.code ?? "";
    const r = importManualCsv(s, "x.csv", csv(`2026-10-28,${added},1,`, `2026-10-26,${code(s, "開発")},2,`), NOW, id);
    expect(r).toMatchObject({ result: "success", added: 2 });
    expectValidState(r.state);
  });

  it("引用符で囲んだメモ（区切り・改行を含む）と BOM・CRLF を扱う", () => {
    const { s: s0, id } = confirmed();
    const text = `\uFEFF作業日,WBSコード,時間,メモ\r\n2026-10-26,${code(s0, "設計")},1,"打合せ, 資料作成"\r\n`;
    const r = importManualCsv(s0, "x.csv", text, NOW, id);
    expect(r).toMatchObject({ result: "success", added: 1 });
    expect(r.state.timeEntries[0].uniqueKey).toMatch(/打合せ, 資料作成$/);
  });

  it("誤りが多いときは、取込履歴のエラーを20件までにして件数を添える", () => {
    const { s: s0, id } = confirmed();
    const lines = Array.from({ length: 30 }, (_, i) => `2026-10-2${i % 3},${code(s0, "設計")},0,${i}`);
    const r = importManualCsv(s0, "x.csv", csv(...lines), NOW, id);
    expect(r.errors).toHaveLength(30);
    expect(r.state.syncRuns.at(-1)?.error).toMatch(/（ほか10件）$/);
  });
});
