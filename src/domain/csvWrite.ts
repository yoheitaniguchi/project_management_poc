// CSV の書き出し（CLAUDE.md 6.3：先頭が = + - @ の値を、表計算ソフトが数式として解釈しないようにする）
//
// 数式として解釈されうる先頭の文字（= + - @ と、その全角、タブ・改行）で始まる値は、先頭に ' を付けて文字として扱わせる。
// 表計算ソフトは先頭の空白（半角・全角）を読み飛ばすことがあるため、空白の後に続く場合も同じに扱う。
// 数値（有限の number）は数式にならないので、そのまま書く。
// 区切り・引用符・改行を含む値は引用符で囲み、引用符は二重にする

const FORMULA_START = /^[ \u3000]*[=+\-@＝＋－＠\t\r\n]/;

export type CsvValue = string | number;

/** 1つの値を CSV のセルにする */
export function csvCell(value: CsvValue): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("CSV に書き出せない数値です");
    return String(value);
  }
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** 行の並びを CSV の文字列にする（改行は CRLF） */
export function toCsv(rows: readonly (readonly CsvValue[])[]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
