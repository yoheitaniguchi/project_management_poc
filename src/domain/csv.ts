// CSV の読み込み（RFC 4180 相当）。外部入力として扱い、大きさ・行数・列数に上限を設ける（CLAUDE.md 6.3）。
// 依存パッケージを増やさないよう、小さな関数で書く
import { LIMITS } from "./validate";

/** rows と同じ順に、各行が始まるファイル上の行番号（1から。誤りの場所を示すため） */
export type CsvParseResult = { ok: true; rows: string[][]; lines: number[] } | { ok: false; error: string };

/** CSV の1行あたりの列数の上限 */
const MAX_COLUMNS = 100;

/**
 * CSV の文字列を行と列に分ける。先頭の BOM を除き、改行は CRLF・LF・CR を受け付ける。
 * 引用符（"）で囲んだ値の中の区切り・改行・二重の引用符（""）を扱う。閉じた引用符の後ろは区切りか改行だけを許す。
 * 空の行と、すべての列が空の行（表計算ソフトが書く ",,," など）は捨てる。
 * 大きさの上限は文字数で数える（バイト数の上限は、画面でファイルを読む前に確かめる）
 */
export function parseCsv(text: string): CsvParseResult {
  if (text.length > LIMITS.maxBytes) return { ok: false, error: "ファイルが大きすぎます" };
  const src = text.startsWith("﻿") ? text.slice(1) : text;
  const rows: string[][] = [];
  const lines: number[] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;
  let line = 1;
  let rowStart = 1;
  let error: string | null = null;
  const endField = () => {
    row.push(field);
    field = "";
    afterQuote = false;
    if (row.length > MAX_COLUMNS) error = `${rowStart}行目：列が多すぎます`;
  };
  const endRow = () => {
    endField();
    if (row.some((v) => v !== "")) {
      rows.push(row);
      lines.push(rowStart);
    }
    row = [];
    if (rows.length > LIMITS.maxItems) error = "行が多すぎます";
  };
  for (let i = 0; i < src.length && error === null; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
        afterQuote = true;
      } else {
        if (c === "\n" || (c === "\r" && src[i + 1] !== "\n")) line++;
        field += c;
      }
      continue;
    }
    if (c === ",") {
      endField();
    } else if (c === "\r" || c === "\n") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      endRow();
      line++;
      rowStart = line;
    } else if (afterQuote) {
      error = `${line}行目：閉じた引用符の後ろに文字があります`;
    } else if (c === '"') {
      if (field !== "") error = `${line}行目：引用符の位置が正しくありません`;
      quoted = true;
    } else {
      field += c;
    }
  }
  if (error !== null) return { ok: false, error };
  if (quoted) return { ok: false, error: "引用符が閉じていません" };
  if (field !== "" || row.length > 0 || afterQuote) endRow();
  if (error !== null) return { ok: false, error };
  return { ok: true, rows, lines };
}
