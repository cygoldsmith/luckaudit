import {
  compact,
  dateTime,
  money,
  type PnlPoint,
  type RecordTest,
} from "@/lib/domain";

export function ProfitChart({ points }: { points: PnlPoint[] }) {
  const series = points.slice(-1500),
    valid = series.filter((p) => p.trade_pnl !== null);
  if (valid.length < 2)
    return (
      <div className="chart-empty">
        Not enough historical API points to plot a P&L curve.
      </div>
    );
  const low = Math.min(0, ...valid.map((p) => p.trade_pnl!)),
    high = Math.max(0, ...valid.map((p) => p.trade_pnl!)),
    range = high - low || 1;
  const start = series[0].timestamp,
    end = series.at(-1)!.timestamp;
  const x = (t: number) => 65 + ((t - start) / (end - start || 1)) * 625;
  const y = (v: number) => 190 - ((v - low) / range) * 150;
  const paths: string[] = [];
  let line = "";
  for (const point of series) {
    if (point.trade_pnl === null) {
      if (line) paths.push(line);
      line = "";
    } else
      line += `${line ? " L" : "M"}${x(point.timestamp).toFixed(1)},${y(point.trade_pnl).toFixed(1)}`;
  }
  if (line) paths.push(line);
  return (
    <div className="data-chart">
      <svg
        viewBox="0 0 720 235"
        role="img"
        aria-label={`API trading P&L from ${dateTime(start)} to ${dateTime(end)}. Latest available value ${money(valid.at(-1)!.trade_pnl)}. Missing values appear as gaps.`}
      >
        <title>Cumulative API trading P&L, USD</title>
        {[0, 0.5, 1].map((n) => {
          const v = low + n * range;
          return (
            <g key={n}>
              <line
                x1="65"
                x2="690"
                y1={y(v)}
                y2={y(v)}
                stroke="#e9eaec"
                strokeDasharray="4 5"
              />
              <text x="52" y={y(v) + 4} textAnchor="end">
                {v < 0 ? "−" : ""}${compact(Math.abs(v))}
              </text>
            </g>
          );
        })}
        {paths.map((d, i) => (
          <path
            key={i}
            d={d}
            fill="none"
            stroke="#114bdf"
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
        ))}
        {valid.map((p, i) => (
          <circle
            key={`${p.timestamp}-${i}`}
            cx={x(p.timestamp)}
            cy={y(p.trade_pnl!)}
            r="4"
            fill="transparent"
          >
            <title>
              {dateTime(p.timestamp)}: {money(p.trade_pnl)}
            </title>
          </circle>
        ))}
        <text x="65" y="220">
          {new Date(start * 1000).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })}
        </text>
        <text x="690" y="220" textAnchor="end">
          {new Date(end * 1000).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })}
        </text>
      </svg>
    </div>
  );
}

/** Exact distribution of win counts for a wallet with no edge, with the observed count marked. */
export function WinsChart({ record: r }: { record: RecordTest }) {
  const n = r.pmf.length,
    max = Math.max(...r.pmf, 1e-12),
    bw = 625 / n,
    x = (k: number) => 65 + k * bw;
  const fmt = (v: number) => (v < 0.001 ? v.toExponential(1) : `${(v * 100).toFixed(1)}%`);
  return (
    <div className="data-chart">
      <svg
        viewBox="0 0 720 250"
        role="img"
        aria-label={`Chance of each number of wins out of ${r.observations} for a wallet with no edge. Observed ${r.wins} wins; ${r.expected.toFixed(2)} expected. Exact chance of at least ${r.wins} wins: ${r.p === null ? "not computed" : fmt(r.p)}.`}
      >
        <title>Wins expected by luck alone (exact Poisson-binomial)</title>
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1="65" x2="690" y1={200 - t * 145} y2={200 - t * 145} stroke="#e9eaec" strokeDasharray="4 5" />
            <text x="53" y={204 - t * 145} textAnchor="end">
              {fmt(t * max)}
            </text>
          </g>
        ))}
        {r.pmf.map((v, k) => (
          <rect
            key={k}
            x={x(k) + 1}
            y={200 - (v / max) * 145}
            width={Math.max(1, bw - 2)}
            height={(v / max) * 145}
            rx="2"
            fill={k >= r.wins ? "#8b93a4" : "#c3c7d0"}
          >
            <title>
              {k} wins: {fmt(v)}
            </title>
          </rect>
        ))}
        <line x1={x(r.wins) + bw / 2} x2={x(r.wins) + bw / 2} y1="31" y2="205" stroke="#555d6c" strokeWidth="2" strokeDasharray="5 4" />
        <circle cx={x(r.wins) + bw / 2} cy="30" r="4" fill="#454e5f" />
        <text x={Math.max(130, Math.min(620, x(r.wins) + bw / 2))} y="17" textAnchor="middle" className="observed-label">
          Observed {r.wins} wins
        </text>
        <text x="65" y="225">
          0
        </text>
        <text x="690" y="225" textAnchor="end">
          {n - 1}
        </text>
        <text x="380" y="245" textAnchor="middle">
          Wins out of {r.observations} bets if the wallet had no edge · shaded: at least as many as observed
        </text>
      </svg>
    </div>
  );
}
