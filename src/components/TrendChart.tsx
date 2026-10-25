// PV・EV・AC の推移の折れ線（CLAUDE.md 7.3）。依存パッケージを増やさず SVG で描く。
// 色だけに頼らないよう、線の種類（実線・破線・点線）と線の端のラベルで区別する。同じ値は画面の表でも示す
export interface TrendPoint {
  asOf: string;
  version: number;
  pv: number;
  ev: number;
  ac: number;
}

const W = 640;
const H = 260;
const PAD = { left: 56, right: 48, top: 16, bottom: 48 };

// 色はテーマ（ライト・ダーク）に合わせてCSSの変数で決める（CR-007）。SVGの属性では変数を使えないので style で指定する
const SERIES = [
  { key: "pv", label: "PV", color: "var(--chart-pv)", dash: undefined },
  { key: "ev", label: "EV", color: "var(--chart-ev)", dash: "8 4" },
  { key: "ac", label: "AC", color: "var(--chart-ac)", dash: "2 4" },
] as const;

/** 目盛りの間隔（1・2・5 × 10^n） */
function niceStep(max: number): number {
  const raw = max / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? raw;
}

export function TrendChart({ points }: { points: TrendPoint[] }) {
  const maxValue = Math.max(1, ...points.flatMap((p) => [p.pv, p.ev, p.ac]));
  const step = niceStep(maxValue);
  const top = Math.ceil(maxValue / step) * step;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  // 横軸は基準日の間隔に比例させる（間が空いた週で傾きの印象が変わらないように）
  const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
  const first = day(points[0].asOf);
  const span = day(points[points.length - 1].asOf) - first;
  const x = (i: number) => PAD.left + (span === 0 ? innerW / 2 : (innerW * (day(points[i].asOf) - first)) / span);
  const y = (v: number) => PAD.top + innerH - (innerH * v) / top;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const last = points[points.length - 1];
  // 線の端のラベルは、値が近いと重なるので、上から順に12px以上あける
  const labelY = new Map<string, number>();
  let prev = -Infinity;
  for (const sr of [...SERIES].sort((a, b) => y(last[a.key]) - y(last[b.key]))) {
    const ly = Math.max(y(last[sr.key]) + 4, prev + 12);
    labelY.set(sr.key, ly);
    prev = ly;
  }
  const summary =
    `PV・EV・ACの推移の折れ線。${points.length}件、${points[0].asOf}から${last.asOf}まで。` +
    `最新はPV ${round(last.pv)}時間、EV ${round(last.ev)}時間、AC ${round(last.ac)}時間。数値は下の表にもあります`;

  return (
    <svg className="trend-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="trend-chart__grid" />
          <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end" fontSize="11">
            {round(t)}
          </text>
        </g>
      ))}
      <text x={12} y={PAD.top + innerH / 2} fontSize="11" transform={`rotate(-90 12 ${PAD.top + innerH / 2})`} textAnchor="middle">
        時間
      </text>
      {points.map((p, i) => (
        <g key={`${p.asOf}-${p.version}`}>
          <text x={x(i)} y={H - PAD.bottom + 16} textAnchor="middle" fontSize="11">
            {p.asOf.slice(5)}
          </text>
          {/* 版が変わった点に印を付ける */}
          {i > 0 && points[i - 1].version !== p.version && (
            <g>
              <line x1={x(i)} x2={x(i)} y1={PAD.top} y2={PAD.top + innerH} className="trend-chart__marker" strokeDasharray="3 3" />
              <text x={x(i)} y={H - PAD.bottom + 32} textAnchor="middle" fontSize="11">
                v{p.version}から
              </text>
            </g>
          )}
        </g>
      ))}
      {SERIES.map((s) => (
        <g key={s.key}>
          {points.length > 1 && (
            <polyline
              fill="none"
              style={{ stroke: s.color }}
              strokeWidth={2}
              strokeDasharray={s.dash}
              points={points.map((p, i) => `${x(i)},${y(p[s.key])}`).join(" ")}
            />
          )}
          {points.map((p, i) => (
            <circle key={i} cx={x(i)} cy={y(p[s.key])} r={3} style={{ fill: s.color }} />
          ))}
          <text x={x(points.length - 1) + 8} y={labelY.get(s.key)} fontSize="12" className="trend-chart__label" style={{ fill: s.color }} fontWeight="bold">
            {s.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

const round = (v: number) => Math.round(v * 100) / 100;
