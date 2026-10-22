// CSV の読み込み（RFC 4180 相当）。外部入力として扱い、大きさ・行数・列数に上限を設ける（CLAUDE.md 6.3）。
// 依存パッケージを増やさないよう、小さな関数で書く
import { LIMITS } from "./validate";

export type CsvParseResult = { ok: true; rows: string[][] } | { ok: false; error: string };

/** CSV の1行あたりの列数の上限 */
const MAX_COLUMNS = 100;

/**
 * CSV の文字列を行と列に分ける。先頭の BOM を除き、改行は CRLF・LF の両方を受け付ける。
 * 引用符（"）で囲んだ値の中の区切り・改行・二重の引用符（""）を扱う。空の行は捨てる
 */
export function parseCsv(text: string): CsvParseResult {
  if (text.length > LIMITS.maxBytes) return { ok: false, error: "ファイルが大きすぎます" };
  const src = text.startsWith("\uFEFF") ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };
  while (i < src.length) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      if (field !== "") return { ok: false, error: `${rows.length + 1}行目：引用符の位置が正しくありません` };
      quoted = true;
    } else if (c === ",") {
      endField();
      if (row.length > MAX_COLUMNS) return { ok: false, error: `${rows.length + 1}行目：列が多すぎます` };
    } else if (c === "\r" || c === "\n") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      endRow();
      if (rows.length > LIMITS.maxItems) return { ok: false, error: "行が多すぎます" };
    } else {
      field += c;
    }
    i++;
  }
  if (quoted) return { ok: false, error: "引用符が閉じていません" };
  if (field !== "" || row.length > 0) endRow();
  if (rows.length > LIMITS.maxItems) return { ok: false, error: "行が多すぎます" };
  return { ok: true, rows };
}
