// 簡易EVMの指標と要対応の判定（CLAUDE.md 5章）。読み込み時の検証（validate.ts）でも使うため、ほかのモジュールに依存しない形で分けている
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
