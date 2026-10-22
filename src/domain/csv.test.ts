import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";

describe("CSV の読み込み", () => {
  it("BOM・CRLF・空の行・引用符の中の区切り・改行・二重の引用符を扱う", () => {
    const text = '\uFEFFa,b,c\r\n1,"x, y","say ""hi"""\r\n\r\n2,"line1\nline2",\n';
    expect(parseCsv(text)).toEqual({ ok: true, rows: [["a", "b", "c"], ["1", "x, y", 'say "hi"'], ["2", "line1\nline2", ""]] });
  });

  it("最後の行に改行が無くてもよい", () => {
    expect(parseCsv("a,b\n1,2")).toEqual({ ok: true, rows: [["a", "b"], ["1", "2"]] });
  });

  it("閉じていない引用符、値の途中の引用符は誤り", () => {
    expect(parseCsv('a,"b\n1,2').ok).toBe(false);
    expect(parseCsv('a,b"c\n').ok).toBe(false);
  });

  it("列が多すぎる行、行が多すぎるファイルは誤り", () => {
    expect(parseCsv(",".repeat(200)).ok).toBe(false);
    expect(parseCsv("a\n".repeat(10_002)).ok).toBe(false);
  });
});
