import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";
import { csvCell, toCsv } from "./csvWrite";

describe("CSV の書き出し（6.3）", () => {
  it.each(["=1+1", "+1", "-1", "@SUM(A1)", "\tx", "\rx"])("先頭が数式として解釈されうる値（%j）は、' を付けて文字にする", (v) => {
    expect(csvCell(v).replace(/^"/, "").startsWith("'")).toBe(true);
  });

  it("普通の値・日付・途中の記号はそのまま", () => {
    expect(csvCell("2.1 設計")).toBe("2.1 設計");
    expect(csvCell("2026-10-26")).toBe("2026-10-26");
    expect(csvCell("a=b")).toBe("a=b");
  });

  it("区切り・引用符・改行を含む値は引用符で囲み、読み戻すと元の値（数式の対策の ' を除く）になる", () => {
    const rows = [["a,b", 'say "hi"', "1行目\n2行目", "=危険"]];
    const text = toCsv(rows);
    expect(text).toBe('"a,b","say ""hi""","1行目\n2行目",\'=危険\r\n');
    expect(parseCsv(text)).toEqual({ ok: true, rows: [["a,b", 'say "hi"', "1行目\n2行目", "'=危険"]], lines: [1] });
  });
});
