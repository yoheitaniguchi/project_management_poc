// 簡易EVM（CLAUDE.md 5章）。工数は時間（h）で扱い、金額は扱わない。
// 基準は常に最新の承認済みベースライン（4章）。計算は基準日の時点で行い、「基準日まで」は基準日を含む。
// 人間の判断（2026-10-22）：
// - 凍結した明細の期間に営業日が無い（確定後に祝日を足した）WPは、計画工数を計画終了日に全量計上する
// - 改版で外したWPの実績も AC に含める（実績は事実なので消さない。BAC・PV・EV は最新の版の明細だけで計算する）
import { latestBaselineOf, type AppState, type BaselineItem } from "./types";
import { businessDayCounter } from "./calendar";
import { isValidDate } from "./validate";

export type WpStatus = "not_started" | "in_progress" | "done";

/** EV の出来高の割合（0/50/100ルール） */
const EARNED: Record<WpStatus, number> = { not_started: 0, in_progress: 0.5, done: 1 };

/**
 * 基準日の時点の WP の状態（5章）。
 * 完了：完了日が基準日以前。着手：完了ではなく、作業日が基準日以前の実績が1件以上。未着手：それ以外
 */
export function wpStatusAt(state: AppState, wbsNodeId: string, asOf: string): WpStatus {
  return statusLookup(state, asOf)(wbsNodeId);
}

/** 基準日の WP の状態を引く関数（WBS要素と実績を1回だけなめて表にする。明細が多くても重くならないように） */
function statusLookup(state: AppState, asOf: string): (wbsNodeId: string) => WpStatus {
  const completedOn = new Map(state.wbsNodes.map((n) => [n.id, n.completedOn]));
  const started = new Set(state.timeEntries.filter((t) => t.workDate <= asOf).map((t) => t.wbsNodeId));
  return (id) => {
    const done = completedOn.get(id);
    if (done != null && done <= asOf) return "done";
    return started.has(id) ? "in_progress" : "not_started";
  };
}

/** 明細の計画工数のうち、基準日までに配分される分（営業日に均等に配分。開始日と終了日の両方を含む） */
export function plannedValueOf(item: BaselineItem, asOf: string, holidays: readonly string[]): number {
  return plannedValueWith(item, asOf, businessDayCounter(holidays));
}

function plannedValueWith(item: BaselineItem, asOf: string, count: (start: string, end: string) => number): number {
  const total = count(item.plannedStart, item.plannedEnd);
  // 営業日が無い明細は、計画終了日に全量を計上する（人間の判断）
  if (total === 0) return item.plannedEnd <= asOf ? item.plannedHours : 0;
  if (asOf < item.plannedStart) return 0;
  const elapsed = count(item.plannedStart, asOf < item.plannedEnd ? asOf : item.plannedEnd);
  return (item.plannedHours * elapsed) / total;
}

export interface Indicators {
  cpi: number | null;
  spi: number | null;
  eac: number | null;
  consumptionRate: number | null;
  progressRate: number | null;
}

/** 5章の指標。算出できないものは null（CPI：AC=0、SPI：PV=0、EAC：CPI が無いか0、消化率・進捗率：BAC=0） */
export function indicators(bac: number, pv: number, ev: number, ac: number): Indicators {
  const cpi = ac > 0 ? ev / ac : null;
  return {
    cpi,
    spi: pv > 0 ? ev / pv : null,
    eac: cpi !== null && cpi > 0 ? bac / cpi : null,
    consumptionRate: bac > 0 ? ac / bac : null,
    progressRate: bac > 0 ? ev / bac : null,
  };
}

/**
 * 工数消化率 − 進捗率（ポイント）＝（AC − EV）÷ BAC × 100。BAC が0なら null。
 * 浮動小数の誤差を避けるため、割り算を1回にしてから、ポイント単位（整数）に四捨五入する（−0 は 0 にする）
 */
export function gapPoints(bac: number, ev: number, ac: number): number | null {
  if (bac <= 0) return null;
  return Math.round(((ac - ev) * 100) / bac) + 0;
}

/** 要対応：ずれが閾値を超えたとき（ちょうど閾値は要対応にしない） */
export const isAlert = (gap: number | null, thresholdPoints: number): boolean => gap !== null && gap > thresholdPoints;

export interface EvmResult extends Indicators {
  baselineId: string;
  version: number;
  asOf: string;
  bac: number;
  pv: number;
  ev: number;
  ac: number;
  gapPoints: number | null;
  alert: boolean;
}

/** 基準日の簡易EVM。ベースラインが無い、または基準日が日付でなければ null */
export function computeEvm(state: AppState, asOf: string): EvmResult | null {
  const baseline = latestBaselineOf(state.baselines);
  if (!baseline || !isValidDate(asOf)) return null;
  const items = state.baselineItems.filter((x) => x.baselineId === baseline.id);
  const count = businessDayCounter(state.settings.holidays);
  const statusOf = statusLookup(state, asOf);
  let bac = 0;
  let pv = 0;
  let ev = 0;
  for (const item of items) {
    bac += item.plannedHours;
    pv += plannedValueWith(item, asOf, count);
    ev += item.plannedHours * EARNED[statusOf(item.wbsNodeId)];
  }
  // AC は基準日までのすべての実績（改版で外したWP・ベースラインの後に足したWPの実績も含む）
  const ac = state.timeEntries.filter((t) => t.workDate <= asOf).reduce((sum, t) => sum + t.minutes, 0) / 60;
  const ind = indicators(bac, pv, ev, ac);
  const gap = gapPoints(bac, ev, ac);
  return { baselineId: baseline.id, version: baseline.version, asOf, bac, pv, ev, ac, ...ind, gapPoints: gap, alert: isAlert(gap, state.settings.alertThresholdPoints) };
}
