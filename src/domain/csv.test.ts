import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";

describe("CSV の読み込み", () => {
  it("BOM・CRLF・空の行・引用符の中の区切り・改行・二重の引用符を扱い、各行の開始行番号を返す", () => {
    const text = '﻿a,b,c\r\n1,"x, y","say ""hi"""\r\n\r\n2,"line1\nline2",\n3,,\n';
    expect(parseCsv(text)).toEqual({
      ok: true,
      rows: [["a", "b", "c"], ["1", "x, y", 'say "hi"'], ["2", "line1\nline2", ""], ["3", "", ""]],
      lines: [1, 2, 4, 6],
    });
  });

  it("最後の行に改行が無くてもよい。CR だけの改行も受け付ける。引用符で囲んだ空の値", () => {
    expect(parseCsv("a,b\n1,2")).toEqual({ ok: true, rows: [["a", "b"], ["1", "2"]], lines: [1, 2] });
    expect(parseCsv("a,b\r1,2\r")).toEqual({ ok: true, rows: [["a", "b"], ["1", "2"]], lines: [1, 2] });
    expect(parseCsv('a,""\n')).toEqual({ ok: true, rows: [["a", ""]], lines: [1] });
  });

  it("すべての列が空の行（,,,）は空の行として捨てる", () => {
    expect(parseCsv("a,b\n,,\n1,2\n")).toEqual({ ok: true, rows: [["a", "b"], ["1", "2"]], lines: [1, 3] });
  });

  it("閉じていない引用符、値の途中の引用符、閉じた引用符の後ろの文字は誤り", () => {
    expect(parseCsv('a,"b\n1,2').ok).toBe(false);
    expect(parseCsv('a,b"c\n').ok).toBe(false);
    expect(parseCsv('a,"abc"def\n')).toEqual({ ok: false, error: "1行目：閉じた引用符の後ろに文字があります" });
    expect(parseCsv('a,"abc" \n').ok).toBe(false);
  });

  it("列は100まで。行が多すぎるファイルは誤り", () => {
    expect(parseCsv(Array(100).fill("x").join(",")).ok).toBe(true);
    expect(parseCsv(Array(101).fill("x").join(",")).ok).toBe(false);
    expect(parseCsv("a\n".repeat(10_002)).ok).toBe(false);
  });
});
