import { describe, expect, it } from "vitest";
import { asanaImportCsv, asanaImportRows } from "./asanaExport";
import { parseCsv } from "./csv";
import type { OpResult } from "./proposal";
import { addObjective, updateObjective } from "./proposal";
import { expectValidState } from "./testState";
import { createInitialState, type AppState } from "./types";
import { expandTemplate, setEstimate, setExcluded, setTrace, updateNode } from "./wbs";

const ids = () => {
  let n = 0;
  return () => `id${++n}`;
};
const okState = (r: OpResult): AppState => {
  if (!r.ok) throw new Error(r.error);
  expectValidState(r.state);
  return r.state;
};

function planned() {
  const id = ids();
  let s = okState(addObjective(createInitialState(), id));
  s = okState(updateObjective(s, s.objectives[0].id, { content: "基準線を作る" }));
  s = okState(expandTemplate(s, id));
  const wp = (name: string) => s.wbsNodes.find((n) => n.name === name)?.id ?? "";
  s = okState(setTrace(s, wp("設計"), s.objectives[0].id, true, id));
  s = okState(setEstimate(s, wp("設計"), { hours: 3, basis: "" }, id));
  s = okState(updateNode(s, wp("設計"), { plannedStart: "2026-10-26", plannedEnd: "2026-10-30" }));
  s = okState(setExcluded(s, wp("運用設計"), true, "本番リリースなし"));
  return { s, wp };
}

describe("Asana の CSV インポート用の書き出し", () => {
  it("対象外を除くWPを、WBSコード順に、名前・説明・開始日・期日・セクションの列で書き出す", () => {
    const { s } = planned();
    const rows = asanaImportRows(s);
    expect(rows.map((r) => r[0])).not.toContain(expect.stringMatching(/運用設計/));
    expect(rows.map((r) => r[0])).toEqual([...rows.map((r) => r[0])].sort((a, b) => a.localeCompare(b, "ja", { numeric: true })));
    const design = rows.find((r) => r[0].endsWith("設計") && !r[0].includes("運用"));
    expect(design).toEqual(["2.1 設計", "作業区分：機能\n紐付く目的：O1 基準線を作る\n見積工数：3時間", "2026-10-26", "2026-10-30", "設計・開発"]);
    const none = rows.find((r) => r[0].endsWith("要件定義"));
    expect(none?.[1]).toBe("作業区分：機能\n紐付く目的：なし\n見積工数：未入力");
  });

  it("CSV として読み戻せる。見出しは Name・Description・Start Date・Due Date・Section", () => {
    const { s } = planned();
    const parsed = parseCsv(asanaImportCsv(s));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows[0]).toEqual(["Name", "Description", "Start Date", "Due Date", "Section"]);
    expect(parsed.rows.slice(1)).toEqual(asanaImportRows(s));
  });

  it("作業名や目的が数式として解釈されうる値でも、文字として書き出す（6.3）", () => {
    const { s: s0, wp } = planned();
    const s = okState(updateNode(s0, wp("設計"), { name: "=HYPERLINK(\"http://example.invalid\")" }));
    const text = asanaImportCsv(s);
    expect(text).not.toMatch(/(^|,)=HYPERLINK/m);
    const parsed = parseCsv(text);
    expect(parsed.ok && parsed.rows.some((r) => r[0] === '2.1 =HYPERLINK("http://example.invalid")')).toBe(true);
    // セクション（フェーズ名）は先頭から利用者の入力なので、数式の対策がかかる
    const phase = s.wbsNodes.find((n) => n.name === "設計・開発")?.id ?? "";
    const s2 = okState(updateNode(s, phase, { name: "=1+1" }));
    const parsed2 = parseCsv(asanaImportCsv(s2));
    expect(parsed2.ok && parsed2.rows.find((r) => r[0].startsWith("2.1"))?.[4]).toBe("'=1+1");
  });

  it("フェーズ名が空なら、セクションにはフェーズのコードを書く（Asana でセクションが無名にならないように）", () => {
    const { s: s0 } = planned();
    const phase = s0.wbsNodes.find((n) => n.name === "設計・開発");
    const s = okState(updateNode(s0, phase?.id ?? "", { name: "" }));
    expect(asanaImportRows(s).find((r) => r[0].startsWith("2.1"))?.[4]).toBe(phase?.code);
  });
});
