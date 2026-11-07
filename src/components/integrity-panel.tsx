"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Info, LoaderCircle, RefreshCw } from "lucide-react";
import { requestJson } from "@/lib/client";
import { dateTime, money, shortAddress } from "@/lib/domain";
import type { integrityReport } from "@/lib/integrity/data";
import { EDGE_LABELS, PARTICIPATION_LABELS, TIER_LABELS } from "@/lib/integrity/wallet-spec";
import { LIMITS, SETTINGS, WALLET_SETTINGS } from "@/lib/integrity/settings";

export type IntegrityReport = Awaited<ReturnType<typeof integrityReport>>;

export const fmtP = (p: number | null | undefined) =>
  p === null || p === undefined ? "—" : p < 0.001 ? p.toExponential(1) : p.toFixed(3);
const pct = (v: number | null | undefined, d = 0) =>
  v === null || v === undefined ? "—" : `${(v * 100).toFixed(d)}%`;

export const VERDICTS: Record<string, string> = {
  ...PARTICIPATION_LABELS,
  unusual: "Unusual pre-move buying",
  "nothing-unusual": "Nothing unusual detected",
};
export const DISCLAIMER = "Statistical anomaly under market odds. Consistent with skill, speed, or information. Not an accusation.";

/** Counts single searches in this browser session (each search is its own test). */
function useSearchCount(condition: string) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    try {
      const seen = new Set<string>(JSON.parse(sessionStorage.getItem("integrity-searches") || "[]"));
      seen.add(condition);
      sessionStorage.setItem("integrity-searches", JSON.stringify([...seen]));
      setCount(seen.size);
    } catch {
      setCount(1);
    }
  }, [condition]);
  return count;
}

export default function IntegrityPanel({ condition }: { condition: string }) {
  const [data, setData] = useState<IntegrityReport | null>(null),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0),
    [showAll, setShowAll] = useState(false);
  const searches = useSearchCount(condition);
  useEffect(() => {
    let live = true;
    setError("");
    setData(null);
    requestJson<IntegrityReport>(`/api/integrity/${condition}`)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e instanceof Error ? e.message : "Analysis failed."));
    return () => {
      live = false;
    };
  }, [condition, reload]);

  if (error)
    return (
      <div className="empty-state" role="alert">
        <h3>Wallet analysis unavailable</h3>
        <p>{error}</p>
        <button className="outline-button" onClick={() => setReload((r) => r + 1)}>
          <RefreshCw size={15} /> Retry
        </button>
      </div>
    );
  if (!data)
    return (
      <div className="loading-state" role="status">
        <LoaderCircle className="spin" size={27} />
        <p>Retrieving every trade in this market, then checking each participant&apos;s record in other resolved markets.</p>
      </div>
    );

  const part = data.participation,
    t = data.test,
    rows = [...part.rows].sort(
      (a, b) =>
        Number(b.flagged) - Number(a.flagged) ||
        Number(b.weak) - Number(a.weak) ||
        Number(!!b.card?.tested1) - Number(!!a.card?.tested1) ||
        b.usd - a.usd,
    ),
    visible = showAll ? rows : rows.filter((r) => r.card).slice(0, 40);

  return (
    <div className="integrity">
      {searches > LIMITS.sessionSearchesBeforeHint ? (
        <div className="inline-notice warning">
          <Info size={15} />
          You have checked {searches} markets one at a time this session. Each is its own test;{" "}
          <Link href="/integrity">search several markets together</Link> for a corrected answer.
        </div>
      ) : null}

      <section className={`panel integrity-verdict verdict-${part.verdict}`}>
        <div>
          <div className="eyebrow">WALLET ANALYSIS · {data.method}</div>
          <h2>{PARTICIPATION_LABELS[part.verdict]}</h2>
          <p>{data.headline}</p>
        </div>
        <dl className="integrity-facts">
          <div>
            <dt>Flagged / tested participants</dt>
            <dd>
              {part.flagged} / {part.tested}
            </dd>
          </div>
          <div>
            <dt>Expected from population rate</dt>
            <dd>{part.expected.toFixed(1)}</dd>
          </div>
          <div>
            <dt>Exact binomial p</dt>
            <dd>{fmtP(part.p)}</dd>
          </div>
          <div>
            <dt>Measured false-flag rate</dt>
            <dd>{data.population.empiricalFdr === null ? "not yet measured" : pct(data.population.empiricalFdr, 1)}</dd>
          </div>
        </dl>
      </section>

      {data.coverage.warnings.length ? (
        <div className="inline-notice warning">
          <Info size={15} />
          {data.coverage.warnings.join(" ")}
        </div>
      ) : null}

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Participating wallets</h2>
            <p>
              The {part.examined} largest wallets by volume in this market. {part.inPopulation} appear in the library;{" "}
              {part.tested} have a testable record (at least {WALLET_SETTINGS.minPositions} resolved bets elsewhere).
              Flagged = Test 1 anomaly that survives leave-one-event-out and still clears the cutoff (
              {fmtP(data.population.cutoff)}) with this market&apos;s event removed. Population: {data.population.tested.toLocaleString()}{" "}
              tested wallets across {data.population.markets.toLocaleString()} markets, {data.population.primary} at 5%.
            </p>
          </div>
          <button className="text-button" onClick={() => setShowAll((s) => !s)}>
            {showAll ? "Only wallets with records" : `Show all ${part.examined}`}
          </button>
        </div>
        <div className="table-scroll">
          <table className="records-table">
            <thead>
              <tr>
                <th>Wallet</th>
                <th>Volume here</th>
                <th>Tier</th>
                <th>Record elsewhere</th>
                <th>Test 1 p / q</th>
                <th>Odds ×</th>
                <th>Test 2 timing</th>
                <th>Edge profile</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const c = r.card;
                return (
                  <tr key={r.wallet} className={r.flagged ? "row-flagged" : ""}>
                    <td>
                      <Link className="evidence-link" href={`/wallet/${r.wallet}`}>
                        {shortAddress(r.wallet)}
                        <ArrowUpRight size={12} />
                      </Link>
                    </td>
                    <td>
                      {money(r.usd)}
                      <span className="cell-subline">{pct(r.share, 1)} of volume</span>
                    </td>
                    <td>
                      <span className={`integrity-label tier-${c ? c.tier : "none"} ${r.flagged ? "label-unusual-record" : ""}`}>
                        {!c ? "No library record" : !c.tested1 ? "Not tested" : TIER_LABELS[c.tier]}
                      </span>
                      <span className="cell-subline">
                        {[c?.byRobust ? "BY-robust" : "", c?.loeo === true ? "LOEO pass" : c?.loeo === false ? "LOEO fail" : ""]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </td>
                    <td>
                      {c ? `${c.O} of ${c.n} won` : "—"}
                      <span className="cell-subline">{c ? `${c.E.toFixed(2)} expected` : ""}</span>
                    </td>
                    <td>
                      {c ? fmtP(c.p1) : "—"}
                      <span className="cell-subline">
                        {c?.q1 != null ? `q ${fmtP(c.q1)}` : ""}
                        {r.pExcluding !== null ? ` · without this market ${fmtP(r.pExcluding)}` : ""}
                      </span>
                    </td>
                    <td>{c ? (c.odds === Infinity ? `all ${c.n} won` : c.odds === null ? "—" : `×${c.odds.toFixed(1)}`) : "—"}</td>
                    <td>
                      {c ? `${c.K} vs ${c.EK.toFixed(1)}` : "—"}
                      <span className="cell-subline">{c?.q2 != null ? `q ${fmtP(c.q2)}` : ""}</span>
                    </td>
                    <td>{c ? EDGE_LABELS[c.edge] : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="panel-footnote">
          {DISCLAIMER} Test 1: exact Poisson-binomial on resolved bets, q = max(entry price, calibrated win rate). Test 2:
          first entries within {WALLET_SETTINGS.preJumpHours} hours before favorable price jumps, against other wallets&apos;
          entry rate. Tiers: strong = both tests and LOEO; anomaly = Test 1 and LOEO; weak = otherwise flagged.
        </p>
      </section>

      <details className="panel market-rules" open={t.verdict !== "not-testable"}>
        <summary>Pre-move buying in this market (context, not the verdict)</summary>
        {t.verdict === "not-testable" ? (
          <p className="chart-empty">{t.reason}</p>
        ) : (
          <div className="analysis-grid">
            <section>
              <h3>Hourly Yes price</h3>
              <p className="panel-footnote">
                {t.move
                  ? `Big move ${dateTime(t.move.startTime)}: ${(t.move.from * 100).toFixed(0)}¢ → ${(t.move.to * 100).toFixed(0)}¢. Shaded: the ${SETTINGS.windowHours}-hour pre-move window.`
                  : "No qualifying big move."}
              </p>
              {data.chart ? <HourlyChart chart={data.chart} /> : null}
            </section>
            <section>
              <h3>Pre-move window vs. every earlier window</h3>
              <p className="panel-footnote">
                Score {t.preScore?.toFixed(2)}; {t.atLeastAsHigh} of {t.comparisonWindows} earlier windows at least as high
                (p = {fmtP(t.p)}). Random-time placebo rate for this category:{" "}
                {data.categoryFalseAlarmRate === null ? "not yet measured" : pct(data.categoryFalseAlarmRate, 1)}.
              </p>
              {t.comparisonScores.length && t.preScore !== null ? (
                <ScoreHistogram scores={t.comparisonScores} pre={t.preScore} />
              ) : null}
            </section>
          </div>
        )}
      </details>

      <details className="panel market-rules">
        <summary>Limits of this analysis</summary>
        <ul>
          <li>A flagged record means wins that are unlikely under market odds. Skill, research and fast reading of public news produce the same pattern.</li>
          <li>One-shot insiders are invisible: a fresh wallet with one informed bet has no record to test.</li>
          <li>One person using many wallets looks like many small, unremarkable records.</li>
          <li>Only positions held to resolution are scored; early exits are only partly covered by the timing test.</li>
          <li>Wallets appear as shortened addresses only, with no attempt to link them to people.</li>
        </ul>
      </details>
    </div>
  );
}

function HourlyChart({ chart }: { chart: NonNullable<IntegrityReport["chart"]> }) {
  const { yes, moveHour } = chart;
  const w = 640,
    h = 200,
    pad = 6;
  const path = useMemo(() => {
    const n = yes.length,
      step = Math.max(1, Math.floor(n / 700)),
      pts: string[] = [];
    for (let i = 0; i < n; i += step) pts.push(`${((i / Math.max(1, n - 1)) * (w - 2 * pad) + pad).toFixed(1)},${(h - pad - yes[i] * (h - 2 * pad)).toFixed(1)}`);
    if ((n - 1) % step) pts.push(`${w - pad},${(h - pad - yes[n - 1] * (h - 2 * pad)).toFixed(1)}`);
    return `M${pts.join("L")}`;
  }, [yes]);
  const x = (i: number) => (i / Math.max(1, yes.length - 1)) * (w - 2 * pad) + pad;
  return (
    <svg className="integrity-chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Hourly Yes price with the pre-move window shaded">
      {[0.25, 0.5, 0.75].map((g) => (
        <line key={g} x1={pad} x2={w - pad} y1={h - pad - g * (h - 2 * pad)} y2={h - pad - g * (h - 2 * pad)} className="grid" />
      ))}
      {moveHour !== null ? (
        <>
          <rect
            className="pre-window"
            x={x(moveHour - SETTINGS.windowHours)}
            width={Math.max(3, x(moveHour) - x(moveHour - SETTINGS.windowHours))}
            y={pad}
            height={h - 2 * pad}
          />
          <line className="move-line" x1={x(moveHour)} x2={x(moveHour)} y1={pad} y2={h - pad} />
        </>
      ) : null}
      <path d={path} className="price" />
    </svg>
  );
}

function ScoreHistogram({ scores, pre }: { scores: number[]; pre: number }) {
  const bins = 30,
    lo = Math.min(-1, ...scores, pre),
    hi = Math.max(1, ...scores, pre),
    width = (hi - lo) / bins || 1,
    counts = new Array(bins).fill(0);
  for (const s of scores) counts[Math.min(bins - 1, Math.floor((s - lo) / width))]++;
  const max = Math.max(...counts, 1),
    w = 640,
    h = 160,
    bw = w / bins,
    px = ((pre - lo) / (hi - lo)) * w;
  return (
    <svg className="integrity-chart" viewBox={`0 0 ${w} ${h + 16}`} role="img" aria-label="Distribution of comparison-window scores">
      {counts.map((c, i) => (
        <rect
          key={i}
          className={(i + 1) * width + lo > pre ? "bar above" : "bar"}
          x={i * bw + 1}
          width={bw - 2}
          y={h - (c / max) * h}
          height={(c / max) * h}
        />
      ))}
      <line className="move-line" x1={px} x2={px} y1={0} y2={h} />
      <text x={Math.min(w - 70, px + 4)} y={12} className="chart-label">
        pre-move {pre.toFixed(2)}
      </text>
    </svg>
  );
}
