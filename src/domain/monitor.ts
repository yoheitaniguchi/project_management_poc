// 週次監視画面（CLAUDE.md 7.3）で示す判定。画面から切り離した純粋な関数にする。
// 人間の判断（2026-10-22）：残りのWP・実績が未入力のWPは、表示中のスナップショットの基準日と版で判定する。
// 実績が未入力のWPは「計画開始日が基準日以前で、基準日までの実績が0件のWP」（完了でも実績が0件なら含める）
import { wpStatusAt } from "./evm";
import { latestBaselineOf, type AppState, type EvmSnapshot, type WbsNode } from "./types";

export interface SnapshotWp {
  node: WbsNode;
  /** ベースラインの明細の計画開始日・計画終了日（凍結した値） */
  plannedStart: string;
  plannedEnd: string;
}

/** 判定に使う基準日と版（記録したスナップショット、または作成前のプレビュー） */
export type AsOfAndBaseline = Pick<EvmSnapshot, "asOf" | "baselineId">;

/** 版の明細のWP（WBSコードの順） */
function itemsOfSnapshot(state: AppState, snapshot: AsOfAndBaseline): SnapshotWp[] {
  const nodeById = new Map(state.wbsNodes.map((n) => [n.id, n]));
  return state.baselineItems
    .filter((x) => x.baselineId === snapshot.baselineId)
    .map((x) => {
      const node = nodeById.get(x.wbsNodeId);
      return node ? { node, plannedStart: x.plannedStart, plannedEnd: x.plannedEnd } : null;
    })
    .filter((x): x is SnapshotWp => x !== null)
    .sort((a, b) => (a.node.code < b.node.code ? -1 : a.node.code > b.node.code ? 1 : 0));
}

/**
 * 残りのWP：スナップショットの版の明細のWPのうち、基準日の時点で完了でないもの。
 * 完了・実績は今のデータで判定する（作成した後に完了を取り消したり、過去の作業日の実績を取り込んだりすると、記録した EV・AC と食い違うことがある）
 */
export function remainingWps(state: AppState, snapshot: AsOfAndBaseline): SnapshotWp[] {
  return itemsOfSnapshot(state, snapshot).filter((x) => wpStatusAt(state, x.node.id, snapshot.asOf) !== "done");
}

/** 実績が未入力のWP：計画開始日が基準日以前で、基準日までの実績が0件のもの（完了でも含める） */
export function wpsWithoutActuals(state: AppState, snapshot: AsOfAndBaseline): SnapshotWp[] {
  const withActuals = new Set(state.timeEntries.filter((t) => t.workDate <= snapshot.asOf).map((t) => t.wbsNodeId));
  return itemsOfSnapshot(state, snapshot).filter((x) => x.plannedStart <= snapshot.asOf && !withActuals.has(x.node.id));
}

/** スナップショットの版が、今の最新の版より古いか（改版の後に、まだ新しい版で作っていない） */
export function isOutdatedSnapshot(state: AppState, snapshot: EvmSnapshot): boolean {
  const latest = latestBaselineOf(state.baselines);
  return latest !== null && latest.id !== snapshot.baselineId;
}

export type IndicatorKey = "cpi" | "spi" | "eac" | "consumptionRate" | "progressRate";

/** 算出できない指標の理由（5章の定義から。算出できるなら null） */
export function unavailableReason(snapshot: Pick<EvmSnapshot, IndicatorKey | "ac" | "pv" | "bac">, key: IndicatorKey): string | null {
  if (snapshot[key] !== null) return null;
  switch (key) {
    case "cpi":
      return "実績工数（AC）がまだ0のため";
    case "spi":
      return "基準日までの計画工数（PV）が0のため";
    case "eac":
      return snapshot.cpi === null ? "CPIが算出できないため（実績工数（AC）がまだ0）" : "CPIが0のため（EVが0）";
    case "consumptionRate":
    case "progressRate":
      return "BACが0のため";
  }
}
