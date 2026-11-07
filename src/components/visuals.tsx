export function Logo({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand-mark ${small ? "small" : ""}`} aria-hidden="true">
      <svg width="25" height="25" viewBox="0 0 32 32" fill="none">
        <path
          d="M16 4v24M4 16h24M7.5 7.5l17 17M7.5 24.5l17-17"
          stroke="currentColor"
          strokeWidth="4.5"
          strokeLinecap="round"
        />
        <circle cx="16" cy="16" r="5" fill="currentColor" />
      </svg>
    </span>
  );
}

export function Sparkline({ points, id }: { points: number[]; id: number }) {
  const line = points
    .map(
      (point, i) =>
        `${i === 0 ? "M" : "L"}${((i * 112) / (points.length - 1)).toFixed(1)},${(36 - point * 0.35).toFixed(1)}`,
    )
    .join(" ");
  return (
    <svg
      className="sparkline"
      viewBox="0 0 114 42"
      role="img"
      aria-label="Illustrative profit trend"
    >
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#114bdf" stopOpacity=".14" />
          <stop offset="100%" stopColor="#114bdf" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L112,42 L0,42 Z`} fill={`url(#spark-${id})`} />
      <path
        d={line}
        fill="none"
        stroke="#114bdf"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
