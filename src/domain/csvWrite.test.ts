import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";
import { csvCell, toCsv } from "./csvWrite";

describe("CSV の書き出し（6.3）", () => {
  it.each(["=1+1", "+1", "-1", "@SUM(A1)", "\tx", "\rx", "\nx", "＝1+1", "＋1", "－1", "＠SUM(A1)", " =1+1", "　=1+1", "  ＠x"])(
    "[@security] 先頭が数式として解釈されうる値（%j）は、' を付けて文字にする",
    (v) => {
      expect(csvCell(v).replace(/^"/, "").startsWith("'")).toBe(true);
    },
  );

  it("[@security] WP名に数式を入れても、書き出したCSVのどのセルも数式として始まらない", () => {
    const text = toCsv([["=HYPERLINK(\"http://example.invalid\",\"x\")", "-2+3", " @x", "＝1"]]);
    const parsed = parseCsv(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    for (const cell of parsed.rows[0]) expect(cell).toMatch(/^'/);
  });

  it("普通の値・日付・途中の記号はそのまま", () => {
    expect(csvCell("2.1 設計")).toBe("2.1 設計");
    expect(csvCell("2026-10-26")).toBe("2026-10-26");
    expect(csvCell("a=b")).toBe("a=b");
    expect(csvCell(" 設計")).toBe(" 設計");
  });

  it("数値はそのまま書く（負の数も数式の対策をしない）。有限でない数値は書き出さない", () => {
    expect(csvCell(12.5)).toBe("12.5");
    expect(csvCell(-1)).toBe("-1");
    expect(() => csvCell(Number.NaN)).toThrow();
    expect(() => csvCell(Number.POSITIVE_INFINITY)).toThrow();
  });

  it("区切り・引用符・改行を含む値は引用符で囲み、読み戻すと元の値（数式の対策の ' を除く）になる", () => {
    const rows = [["a,b", 'say "hi"', "1行目\n2行目", "=危険"]];
    const text = toCsv(rows);
    expect(text).toBe('"a,b","say ""hi""","1行目\n2行目",\'=危険\r\n');
    expect(parseCsv(text)).toEqual({ ok: true, rows: [["a,b", 'say "hi"', "1行目\n2行目", "'=危険"]], lines: [1] });
  });
});
