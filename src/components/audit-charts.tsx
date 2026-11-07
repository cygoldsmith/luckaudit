import {
  compact,
  dateTime,
  money,
  type PnlPoint,
  type RecordTest,
} from "@/lib/domain";

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
