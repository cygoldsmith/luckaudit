import { dateTime } from "@/lib/domain";
import type { MarketAudit, MarketInfo } from "@/lib/market-types";
export default function PriceTimeline({
  audit,
  market,
}: {
  audit: MarketAudit;
  market: MarketInfo;
}) {
  const points = audit.timeline;
  if (points.length < 2)
    return (
      <div className="chart-empty">
        Not enough observed prices to draw a timeline.
      </div>
    );
  const first = points[0].timestamp,
    last = points.at(-1)!.timestamp,
    x = (t: number) => 55 + ((t - first) / (last - first || 1)) * 610,
    y = (p: number) => 185 - p * 155;
  const colors = ["#114bdf", "#c49a62"];
  return (
    <div className="market-price-chart">
      <div className="price-chart-legend">
        {market.outcomes.map((o, i) => (
          <span key={i}>
            <i style={{ background: colors[i] }} />
            {o.label}
          </span>
        ))}
        <small>Observed trade prices · gaps preserved</small>
      </div>
      <svg
        viewBox="0 0 700 230"
        role="img"
        aria-label={`Observed market trade prices from ${dateTime(first)} to ${dateTime(last)}. No quotes or missing prices are inferred.`}
      >
        <title>Observed outcome prices</title>
        {[0, 0.5, 1].map((p) => (
          <g key={p}>
            <line
              x1="55"
              x2="665"
              y1={y(p)}
              y2={y(p)}
              stroke="#e6e8eb"
              strokeDasharray="4 5"
            />
            <text x="42" y={y(p) + 4} textAnchor="end">
              {p * 100}%
            </text>
          </g>
        ))}
        {market.outcomes.map((o, index) => {
          let continuous = false;
          const d = points
            .map((point) => {
              const price = point.prices[index];
              if (price === null || price === undefined) {
                continuous = false;
                return "";
              }
              const command = continuous ? "L" : "M";
              continuous = true;
              return `${command}${x(point.timestamp).toFixed(1)},${y(price).toFixed(1)}`;
            })
            .join(" ");
          return (
            <g key={index}>
              <path
                d={d}
                fill="none"
                stroke={colors[index]}
                strokeWidth="2"
                strokeLinejoin="round"
              />
              {points
                .filter(
                  (p) =>
                    p.prices[index] !== null && p.prices[index] !== undefined,
                )
                .map((p, i) => (
                  <circle
                    key={i}
                    cx={x(p.timestamp)}
                    cy={y(p.prices[index]!)}
                    r="3"
                    fill={colors[index]}
                    opacity=".4"
                  >
                    <title>
                      {o.label}: {(p.prices[index]! * 100).toFixed(1)}% ·{" "}
                      {dateTime(p.timestamp)}
                    </title>
                  </circle>
                ))}
            </g>
          );
        })}
        <text x="55" y="217">
          {dateTime(first)}
        </text>
        <text x="665" y="217" textAnchor="end">
          {dateTime(last)}
        </text>
      </svg>
    </div>
  );
}
