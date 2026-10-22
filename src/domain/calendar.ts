// 営業日（CLAUDE.md 5章：土日を除く。祝日は設定 settings.holidays で指定する）。
// 日付は YYYY-MM-DD の文字列で扱い、タイムゾーンの影響を受けないよう UTC の日付として計算する
const DAY_MS = 24 * 60 * 60 * 1000;

const toUtc = (date: string) => Date.parse(`${date}T00:00:00Z`);
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const toSet = (holidays: readonly string[] | ReadonlySet<string>) => (holidays instanceof Set ? holidays : new Set(holidays));

/** 営業日か。日付として読めない文字列は営業日にしない */
export function isBusinessDay(date: string, holidays: readonly string[] | ReadonlySet<string>): boolean {
  const day = new Date(toUtc(date)).getUTCDay();
  if (Number.isNaN(day)) return false;
  return day !== 0 && day !== 6 && !toSet(holidays).has(date);
}

/**
 * 期間に営業日が1日でもあるか。最初の営業日が見つかったところで止める（確定できない理由の判定用）。
 * 祝日でない平日は数日おきに必ずあるので、祝日の数＋数日で終わる
 */
export function hasBusinessDay(start: string, end: string, holidays: readonly string[]): boolean {
  const set = toSet(holidays);
  const last = toUtc(end);
  for (let t = toUtc(start); t <= last; t += DAY_MS) {
    if (isBusinessDay(fromUtc(t), set)) return true;
  }
  return false;
}

/** 開始日から終了日までの営業日（両端を含む）。開始日が終了日より後なら空 */
export function businessDays(start: string, end: string, holidays: readonly string[]): string[] {
  const days: string[] = [];
  const set = toSet(holidays);
  const last = toUtc(end);
  for (let t = toUtc(start); t <= last; t += DAY_MS) {
    const d = fromUtc(t);
    if (isBusinessDay(d, set)) days.push(d);
  }
  return days;
}

/** 端末の時刻での日付（YYYY-MM-DD）。「今日」を決めるときに使う */
export function localDate(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
