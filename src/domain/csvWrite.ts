// CSV の書き出し（CLAUDE.md 6.3：先頭が = + - @ の値を、表計算ソフトが数式として解釈しないようにする）
//
// 数式として解釈されうる先頭の文字（= + - @ と、タブ・改行）で始まる値は、先頭に ' を付けて文字として扱わせる。
// 区切り・引用符・改行を含む値は引用符で囲み、引用符は二重にする

const FORMULA_START = /^[=+\-@\t\r\n]/;

/** 1つの値を CSV のセルにする */
export function csvCell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** 行の並びを CSV の文字列にする（改行は CRLF） */
export function toCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
