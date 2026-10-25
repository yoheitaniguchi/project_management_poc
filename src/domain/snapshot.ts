// 週次スナップショット（CLAUDE.md 5章：画面のボタンで手動で作成する。基準日の初期値は直近の金曜日。作成後は変更しない）。
// 人間の判断（2026-10-22）：
// - 作成時のずれ・閾値・要対応を記録する（閾値を後で変えても、記録した週の要対応は変わらない）
// - 基準日と版の組で1件まで（改版した後は、同じ基準日を新しい版で作り直せる）
// - 基準日は、未来の日付と、最新の版の合意日より前の日付を受け付けない
// - 監査ログには記録しない（4章で記録が必須の操作ではない。作成後の変更は読み込み時の検査で防ぐ）
import { localDate, localDateTime } from "./calendar";
import { toCsv } from "./csvWrite";
import { computeEvm, type EvmResult } from "./evm";
import type { OpResult } from "./proposal";
import { latestBaselineOf, type AppState, type EvmSnapshot } from "./types";
import { isPlanDate } from "./validate";

const DAY_MS = 24 * 60 * 60 * 1000;

/** 基準日の初期値：今日以前で直近の金曜日（今日が金曜日なら今日）。今日は端末の地域の日付 */
export function defaultAsOf(now: Date): string {
  const today = localDate(now);
  const t = Date.parse(`${today}T00:00:00Z`);
  const back = (new Date(t).getUTCDay() - 5 + 7) % 7;
  return new Date(t - back * DAY_MS).toISOString().slice(0, 10);
}

/** 基準日でスナップショットを作れない理由。作れるなら null（作成前に画面で理由を示すためにも使う） */
export function snapshotAsOfError(state: AppState, asOf: string, now: Date): string | null {
  const baseline = latestBaselineOf(state.baselines);
  if (!baseline) return "ベースラインが未確定です。計画画面でベースラインを確定してください";
  if (typeof asOf !== "string" || !isPlanDate(asOf)) return "基準日を入力してください";
  if (asOf > localDate(now)) return "基準日に未来の日付は入れられません";
  if (asOf < baseline.approvedOn) return `基準日が、最新の版（v${baseline.version}）の合意日（${baseline.approvedOn}）より前です`;
  if (state.evmSnapshots.some((e) => e.baselineId === baseline.id && e.asOf === asOf)) {
    return `基準日 ${asOf} の v${baseline.version} のスナップショットは作成済みです。別の基準日を選んでください`;
  }
  return null;
}

export type SnapshotPreview = { ok: true; evm: EvmResult } | { ok: false; error: string };

/** 作成する前の値（プレビュー。記録はしない） */
export function previewSnapshot(state: AppState, asOf: string, now: Date): SnapshotPreview {
  const error = snapshotAsOfError(state, asOf, now);
  if (error) return { ok: false, error };
  const evm = computeEvm(state, asOf);
  return evm ? { ok: true, evm } : { ok: false, error: "計算できませんでした" };
}

/** 週次スナップショットを作成する（追記のみ） */
export function createSnapshot(state: AppState, asOf: string, now: Date, newId: () => string): OpResult {
  const preview = previewSnapshot(state, asOf, now);
  if (!preview.ok) return { ok: false, error: preview.error };
  const e = preview.evm;
  const snapshot: EvmSnapshot = {
    id: newId(),
    baselineId: e.baselineId,
    asOf: e.asOf,
    pv: e.pv,
    ev: e.ev,
    ac: e.ac,
    bac: e.bac,
    cpi: e.cpi,
    spi: e.spi,
    eac: e.eac,
    consumptionRate: e.consumptionRate,
    progressRate: e.progressRate,
    gapPoints: e.gapPoints,
    thresholdPoints: state.settings.alertThresholdPoints,
    alert: e.alert,
    createdAt: now.toISOString(),
  };
  return { ok: true, state: { ...state, evmSnapshots: [...state.evmSnapshots, snapshot] } };
}

/** 版番号（基準にしたベースラインの版）。見つからなければ 0 */
export function versionOfSnapshot(state: AppState, snapshot: EvmSnapshot): number {
  return state.baselines.find((b) => b.id === snapshot.baselineId)?.version ?? 0;
}

/** 基準日の順（同じ基準日は版の順）に並べたスナップショット。推移の表示とCSVの出力に使う */
export function sortedSnapshots(state: AppState): EvmSnapshot[] {
  return [...state.evmSnapshots].sort((a, b) => (a.asOf !== b.asOf ? (a.asOf < b.asOf ? -1 : 1) : versionOfSnapshot(state, a) - versionOfSnapshot(state, b)));
}

/** 最新のスナップショット：基準日が最も新しいもの（同じ基準日なら版が新しいもの）。無ければ null */
export function latestSnapshot(state: AppState): EvmSnapshot | null {
  const sorted = sortedSnapshots(state);
  return sorted[sorted.length - 1] ?? null;
}

// ---------------------------------------------------------------- CSV の出力（7.3：現状値の採取のため）

/** 小数を桁数で丸める（−0 は 0 にする） */
const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits + 0;
/** 算出できない値（null）は空欄にする（人間の判断：集計しやすいため） */
const cell = (v: number | null, digits: number) => (v === null ? "" : round(v, digits));

export const SNAPSHOT_CSV_HEADER = [
  "基準日", "版", "BAC（時間）", "PV（時間）", "EV（時間）", "AC（時間）", "CPI", "SPI", "EAC（時間）",
  "工数消化率（%）", "進捗率（%）", "ずれ（ポイント）", "閾値（ポイント）", "要対応", "作成日時（端末の時刻）",
] as const;

/**
 * 週次スナップショットのCSV（UTF-8。BOM は画面で付ける）。基準日の順。
 * 時間・CPI・SPI は小数2桁、率は%で小数1桁に丸める。作成日時は端末の時刻（人間の判断）。算出できない値は空欄。数値は数値のまま書く（負のずれが数式の対策で文字にならないように）
 */
export function snapshotCsv(state: AppState): string {
  const rows = sortedSnapshots(state).map((e) => [
    e.asOf,
    `v${versionOfSnapshot(state, e)}`,
    round(e.bac, 2),
    round(e.pv, 2),
    round(e.ev, 2),
    round(e.ac, 2),
    cell(e.cpi, 2),
    cell(e.spi, 2),
    cell(e.eac, 2),
    cell(e.consumptionRate === null ? null : e.consumptionRate * 100, 1),
    cell(e.progressRate === null ? null : e.progressRate * 100, 1),
    e.gapPoints ?? "",
    e.thresholdPoints,
    e.alert ? "要対応" : "",
    localDateTime(e.createdAt),
  ]);
  return toCsv([[...SNAPSHOT_CSV_HEADER], ...rows]);
}

/** CSVのファイル名（日付は端末の地域の日付） */
export function snapshotCsvFileName(now: Date): string {
  return `pmpoc-evm-snapshots-${localDate(now).replace(/-/g, "")}.csv`;
}
