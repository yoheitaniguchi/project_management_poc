// 営業日（CLAUDE.md 5章：土日を除く。祝日は設定 settings.holidays で指定する）。
// 日付は YYYY-MM-DD の文字列で扱い、タイムゾーンの影響を受けないよう UTC の日付として計算する
const DAY_MS = 24 * 60 * 60 * 1000;

const toUtc = (date: string) => Date.parse(`${date}T00:00:00Z`);
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function isBusinessDay(date: string, holidays: readonly string[]): boolean {
  const day = new Date(toUtc(date)).getUTCDay();
  return day !== 0 && day !== 6 && !holidays.includes(date);
}

/** 開始日から終了日までの営業日（両端を含む）。開始日が終了日より後なら空 */
export function businessDays(start: string, end: string, holidays: readonly string[]): string[] {
  const days: string[] = [];
  const last = toUtc(end);
  for (let t = toUtc(start); t <= last; t += DAY_MS) {
    const d = fromUtc(t);
    if (isBusinessDay(d, holidays)) days.push(d);
  }
  return days;
}

/** 端末の時刻での日付（YYYY-MM-DD）。「今日」を決めるときに使う */
export function localDate(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
