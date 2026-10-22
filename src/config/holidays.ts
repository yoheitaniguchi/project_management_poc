// 祝日の設定（CLAUDE.md 5章：営業日は土日を除く。祝日は設定ファイルで指定できる）。
// 新しく作るデータの初期値になる。作った後は、データの中の settings.holidays を計算に使う。
// PoC では空で運用する（人間の判断）。足すときは "YYYY-MM-DD" で書く
export const DEFAULT_HOLIDAYS: readonly string[] = [];

/** 要対応の閾値の初期値（ポイント。5章：仮に5ポイント。PoCの結果を見て見直す） */
export const DEFAULT_ALERT_THRESHOLD_POINTS = 5;
