"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Info, LoaderCircle, RefreshCw } from "lucide-react";
import { requestJson } from "@/lib/client";
import { dateTime, money, shortAddress } from "@/lib/domain";
import type { integrityReport } from "@/lib/integrity/data";
import type { WalletLabel } from "@/lib/integrity/core";
import { LIMITS, SETTINGS } from "@/lib/integrity/settings";

export type IntegrityReport = Awaited<ReturnType<typeof integrityReport>>;

const fmtP = (p: number | null | undefined) =>
  p === null || p === undefined ? "—" : p < 0.001 ? p.toExponential(1) : p.toFixed(3);
const pct = (v: number | null | undefined, d = 0) =>
  v === null || v === undefined ? "—" : `${(v * 100).toFixed(d)}%`;

export const WALLET_LABELS: Record<WalletLabel, string> = {
  "unusual-record": "Unusual record elsewhere",
  "nothing-unusual": "Nothing unusual",
  "too-few-bets": "Too few other bets",
  "record-too-short": "Record too short to test",
};

export const VERDICTS: Record<string, string> = {
  unusual: "Unusual pre-move buying",
  "nothing-unusual": "Nothing unusual detected",
  "not-testable": "Not testable",
  "history-too-short": "History too short for this group",
  uncalibrated: "Market test not calibrated for this category",
};

/** Counts single searches in this browser session (the "40 single searches" rule). */
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
    [reload, setReload] = useState(0);
  const searches = useSearchCount(condition);
  useEffect(() => {
    let live = true;
    setError("");
    setData(null);
    requestJson<IntegrityReport>(`/api/integrity/${condition}`)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e instanceof Error ? e.message : "Integrity test failed."));
    return () => {
      live = false;
    };
  }, [condition, reload]);

  if (error)
    return (
      <div className="empty-state" role="alert">
        <h3>Integrity test unavailable</h3>
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
        <p>Retrieving every fill for this market and running the pre-move test. Large markets take up to a minute.</p>
      </div>
    );

  const t = data.test,
    verdictKey = t.verdict !== "not-testable" && data.calibrated === false ? "uncalibrated" : t.verdict,
    favored = t.move ? data.market.outcomes[t.move.favored] : null,
    flagged = data.wallets.rows.filter((r) => r.label === "unusual-record").length;

  return (
    <div className="integrity">
      {searches > LIMITS.sessionSearchesBeforeHint ? (
        <div className="inline-notice warning">
          <Info size={15} />
          You have run {searches} single-market searches this session. Each is its own test; pointing to the one that came
          back unusual skips the correction.{" "}
          <Link href="/integrity">Search several markets together</Link>.
        </div>
      ) : null}
      <section className={`panel integrity-verdict verdict-${verdictKey}`}>
        <div>
          <div className="eyebrow">MARKET TEST · {data.method}</div>
          <h2>{VERDICTS[verdictKey]}</h2>
          <p>{data.headline}</p>
        </div>
        <dl className="integrity-facts">
          <div>
            <dt>p-value</dt>
            <dd>{fmtP(t.p)}</dd>
          </div>
          <div>
            <dt>Comparison windows</dt>
            <dd>{t.comparisonWindows.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Measured false-alarm rate</dt>
            <dd>{data.categoryFalseAlarmRate === null ? "not yet measured" : pct(data.categoryFalseAlarmRate, 1)}</dd>
          </div>
          <div>
            <dt>Percentile</dt>
            <dd>
              {data.comparison.percentile === null
                ? "—"
                : `${pct(data.comparison.percentile)} of ${data.comparison.compared}`}
            </dd>
          </div>
        </dl>
      </section>

      {data.coverage.warnings.length ? (
        <div className="inline-notice warning">
          <Info size={15} />
          {data.coverage.warnings.join(" ")}
        </div>
      ) : null}

      <div className="analysis-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Hourly Yes price</h2>
              <p>
                {t.move
                  ? `Big move ${dateTime(t.move.startTime)}: ${(t.move.from * 100).toFixed(0)}¢ → ${(t.move.to * 100).toFixed(0)}¢. Favored side: ${favored}.`
                  : "No qualifying big move."}
              </p>
            </div>
          </div>
          {data.chart ? <HourlyChart chart={data.chart} /> : <p className="chart-empty">No trades before resolution.</p>}
          <p className="panel-footnote">
            Last trade price per clock hour, carried forward. Shaded: the {SETTINGS.windowHours}-hour pre-move window.
            {t.move ? ` Largest wallet made ${pct(t.move.maxWalletShare)} of the move hour's dollars.` : ""}
          </p>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Pre-move window vs. every earlier window</h2>
              <p>
                {t.preScore === null
                  ? "Not scored."
                  : `Score ${t.preScore.toFixed(2)}; ${t.atLeastAsHigh} of ${t.comparisonWindows} earlier windows scored at least as high.`}
              </p>
            </div>
          </div>
          {t.comparisonScores.length && t.preScore !== null ? (
            <ScoreHistogram scores={t.comparisonScores} pre={t.preScore} />
          ) : (
            <p className="chart-empty">{t.reason}</p>
          )}
          <dl className="integrity-formula">
            <div>
              <dt>Backing</dt>
              <dd>{money(t.backing)}</dd>
            </div>
            <div>
              <dt>Against</dt>
              <dd>{money(t.against)}</dd>
            </div>
            <div>
              <dt>Cushion</dt>
              <dd>{money(t.cushion)}</dd>
            </div>
            <div>
              <dt>p = (1 + {t.atLeastAsHigh ?? "k"}) ÷ (1 + {t.comparisonWindows})</dt>
              <dd>{fmtP(t.p)}</dd>
            </div>
          </dl>
          <p className="panel-footnote">
            Aggressor flow: (backing − against) ÷ (backing + against + cushion). Backing = taker buys of the favored side
            plus taker sells of the other side.
          </p>
        </section>
      </div>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Wallet check</h2>
            <p>
              {data.wallets.rows.length
                ? `${flagged} of ${data.wallets.rows.length} listed wallets flagged. m = ${data.wallets.m}; pre-filter bar ${fmtP(data.wallets.prefilterBar)}; ${data.wallets.correction} across ${data.wallets.tested} tested wallets${data.wallets.correction === "BH" ? ` (bar ${fmtP(data.wallets.threshold)})` : ""}. Records come from ${data.wallets.libraryBets.toLocaleString()} library bets outside this event.`
                : "No wallets backed the favored side by at least $100 in the pre-move window."}
            </p>
          </div>
        </div>
        {data.wallets.rows.length ? (
          <div className="table-scroll">
            <table className="records-table">
              <thead>
                <tr>
                  <th>Wallet</th>
                  <th>{t.move ? "Net behind favored side" : "Winning-side holding"}</th>
                  <th>Record elsewhere</th>
                  <th>Luck ratio</th>
                  <th>p / q</th>
                  <th>Label</th>
                </tr>
              </thead>
              <tbody>
                {data.wallets.rows.map((r) => (
                  <tr key={r.wallet}>
                    <td>
                      <Link className="evidence-link" href={`/wallet/${r.wallet}`}>
                        {shortAddress(r.wallet)}
                        <ArrowUpRight size={12} />
                      </Link>
                    </td>
                    <td>{r.netUsd === null ? "—" : money(r.netUsd)}</td>
                    <td>
                      {r.record.bets.length ? `${r.record.wins} of ${r.record.bets.length} won` : "no library bets"}
                      <span className="cell-subline">
                        {r.record.bets.length ? `${r.record.expected.toFixed(2)} expected` : ""}
                      </span>
                    </td>
                    <td>{r.record.luckRatio === null ? "—" : r.record.luckRatio.toFixed(1)}</td>
                    <td>
                      {fmtP(r.record.p)}
                      <span className="cell-subline">q {fmtP(r.q)}</span>
                    </td>
                    <td>
                      <span className={`integrity-label label-${r.label}`}>{WALLET_LABELS[r.label]}</span>
                      {r.fragile ? <span className="cell-subline">depends on one bet</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <p className="panel-footnote">
          Bets of ${SETTINGS.walletRecord.minCost}+ priced {SETTINGS.walletRecord.minPrice * 100}¢–
          {SETTINGS.walletRecord.maxPrice * 100}¢, held to resolution, one per event, at least{" "}
          {SETTINGS.walletRecord.minBets}. Fair chance = max(price, price-bucket win rate). Exact Poisson-binomial p-values.
          {data.wallets.falseFlagRate === null
            ? " Fake-wallet false-alarm rate not yet measured."
            : ` Fake-wallet false-flag rate ${pct(data.wallets.falseFlagRate, 1)}.`}
        </p>
      </section>

      {t.rejectedMoves.length ? (
        <details className="panel market-rules">
          <summary>Larger jumps that did not qualify ({t.rejectedMoves.length})</summary>
          <ul>
            {t.rejectedMoves.slice(0, 10).map((m) => (
              <li key={m.hour}>
                {m.change > 0 ? "+" : ""}
                {(m.change * 100).toFixed(0)} points: {m.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <details className="panel market-rules">
        <summary>Limits of this test</summary>
        <ul>
          <li>&ldquo;Unusual&rdquo; means unlikely if nobody knew early. Fast readers of public news, or good forecasters, can produce the same pattern.</li>
          <li>&ldquo;Nothing unusual detected&rdquo; is not a clean bill of health. A careful insider who trades small can stay invisible.</li>
          <li>Markets without a sudden move cannot be tested for timing, because the information arrived gradually.</li>
          <li>One person using many wallets looks like many small traders. Wallets are shown as shortened addresses only.</li>
          <li>Results apply only to resolved markets and the library built for this tool ({data.library.markets} markets).</li>
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
      <text x={0} y={h + 14} className="chart-label">
        {lo.toFixed(1)}
      </text>
      <text x={w - 22} y={h + 14} className="chart-label">
        {hi.toFixed(1)}
      </text>
    </svg>
  );
}
