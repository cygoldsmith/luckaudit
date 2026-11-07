"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Info, LoaderCircle, RefreshCw, Search } from "lucide-react";
import AppFrame from "@/components/app-frame";
import { DISCLAIMER, fmtP } from "@/components/integrity-panel";
import { requestJson } from "@/lib/client";
import type { libraryStatus, methodCheck, multiReport } from "@/lib/integrity/data";
import { PARTICIPATION_LABELS } from "@/lib/integrity/wallet-spec";
import { CHANGE_LOG, DATA_CHECK, LIMITS, SETTINGS, WALLET_SETTINGS } from "@/lib/integrity/settings";

type Multi = Awaited<ReturnType<typeof multiReport>>;
type Check = { check: Awaited<ReturnType<typeof methodCheck>> };
type Library = Awaited<ReturnType<typeof libraryStatus>>;
type Tab = "multi" | "check" | "settings";

const pct = (v: number | null | undefined, d = 0) =>
  v === null || v === undefined ? "—" : `${(v * 100).toFixed(d)}%`;
const categoryLabel = (id: string | null) =>
  SETTINGS.library.categories.find((c) => c.id === id)?.label ?? "Uncategorized";

export default function IntegrityPage() {
  const [tab, setTab] = useState<Tab>("multi");
  const [library, setLibrary] = useState<Library | null>(null);
  useEffect(() => {
    requestJson<Library>("/api/integrity/library").then(setLibrary).catch(() => setLibrary(null));
  }, []);
  return (
    <AppFrame active="integrity">
      <main>
        <div className="page-heading">
          <div>
            <h1>Integrity search</h1>
            <p>
              Which markets drew unusually many wallets whose records elsewhere are unlikely under market odds? Every
              verdict carries its p-value, the population base rate and a measured false-flag rate.
            </p>
          </div>
        </div>
        <div className="market-scope-banner">
          <Info size={17} />
          <span>
            <strong>{DISCLAIMER}</strong> Library:{" "}
            {library ? `${library.built.toLocaleString()} of ${library.candidates.toLocaleString()} markets, ${library.bets.toLocaleString()} positions` : "loading…"}.
          </span>
        </div>
        <nav className="investigation-tabs" aria-label="Integrity sections">
          {(
            [
              ["multi", "Search several markets"],
              ["check", "Validation"],
              ["settings", "Parameters"],
            ] as [Tab, string][]
          ).map(([value, label]) => (
            <button key={value} className={value === tab ? "selected" : ""} onClick={() => setTab(value)}>
              {label}
            </button>
          ))}
        </nav>
        {tab === "multi" ? <MultiSearch /> : null}
        {tab === "check" ? <MethodCheck library={library} /> : null}
        {tab === "settings" ? <Parameters /> : null}
      </main>
    </AppFrame>
  );
}

function MultiSearch() {
  const [mode, setMode] = useState<"paste" | "category">("paste"),
    [text, setText] = useState(""),
    [category, setCategory] = useState<string>("politics"),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<Multi | null>(null);
  async function run() {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const conditions = [...new Set(text.match(/0x[\da-fA-F]{64}/g) ?? [])];
      if (mode === "paste" && !conditions.length) throw new Error("Paste at least one market condition ID (0x…64 hex).");
      const body = mode === "paste" ? { conditions } : { category, ...(from ? { from } : {}), ...(to ? { to } : {}) };
      setResult(
        await requestJson<Multi>("/api/integrity/multi", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Search several markets together</h2>
            <p>
              Each market&apos;s flagged-participant count is tested against the population rate; the market p-values are
              then corrected together with Benjamini–Hochberg at 5%.
            </p>
          </div>
        </div>
        <div className="integrity-form">
          <div className="segmented">
            <button className={mode === "paste" ? "selected" : ""} onClick={() => setMode("paste")}>
              Paste markets
            </button>
            <button className={mode === "category" ? "selected" : ""} onClick={() => setMode("category")}>
              Category from library
            </button>
          </div>
          {mode === "paste" ? (
            <textarea
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="One condition ID per line (up to 25). Markets not in the library are fetched live."
            />
          ) : (
            <div className="integrity-filters">
              <label>
                Category
                <select value={category} onChange={(e) => setCategory(e.target.value)}>
                  {SETTINGS.library.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Resolved from
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label>
                to
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </label>
            </div>
          )}
          <button className="primary-button" disabled={busy} onClick={run}>
            {busy ? <LoaderCircle className="spin" size={15} /> : <Search size={15} />}
            {busy ? "Checking participants…" : "Run search"}
          </button>
        </div>
        {error ? (
          <div className="inline-notice warning" role="alert">
            <Info size={15} />
            {error}
          </div>
        ) : null}
      </section>
      {result ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>
                {result.rows.filter((r) => r.verdict === "elevated").length} of {result.M} testable markets show elevated
                participation
              </h2>
              <p>
                Population rate {pct(result.baseRate, 2)} of tested wallets flagged. BH bar for the last flagged rank:{" "}
                {fmtP(result.threshold)}. Measured false-flag rate{" "}
                {result.empiricalFdr === null ? "not yet measured" : pct(result.empiricalFdr, 1)}. Sorted by q-value.
              </p>
            </div>
          </div>
          <div className="table-scroll">
            <table className="records-table">
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Verdict</th>
                  <th>Flagged / tested</th>
                  <th>p / q</th>
                  <th>Flagged volume</th>
                  <th>Pre-move p (context)</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r) => (
                  <tr key={r.condition}>
                    <td>
                      <Link className="evidence-link" href={`/market/${r.condition}`}>
                        {r.title}
                        <ArrowUpRight size={12} />
                      </Link>
                      <span className="cell-subline">
                        {categoryLabel(r.category)} · {r.examined} participants examined
                      </span>
                    </td>
                    <td>
                      <span className={`integrity-label verdict-${r.verdict}`}>{PARTICIPATION_LABELS[r.verdict]}</span>
                    </td>
                    <td>
                      {r.flagged} / {r.tested}
                      <span className="cell-subline">{r.expected.toFixed(1)} expected</span>
                    </td>
                    <td>
                      {fmtP(r.p)}
                      <span className="cell-subline">q {fmtP(r.q)}</span>
                    </td>
                    <td>{pct(r.flaggedVolumeShare, 1)}</td>
                    <td>{fmtP(r.preMoveP)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}

function MethodCheck({ library }: { library: Library | null }) {
  const [data, setData] = useState<Check | null>(null),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    setError("");
    setData(null);
    requestJson<Check>(`/api/integrity/method-check${refresh ? "?refresh=1" : ""}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Validation failed."));
  }, [refresh]);
  if (error) return <div className="inline-notice warning">{error}</div>;
  if (!data)
    return (
      <div className="loading-state" role="status">
        <LoaderCircle className="spin" size={27} />
        <p>Running the placebos and the positive control on the library…</p>
      </div>
    );
  const c = data.check,
    pop = c.population;
  return (
    <>
      {library && library.built < 500 ? (
        <div className="inline-notice warning">
          <Info size={15} />
          Only {library.built} library markets are built. Run <code>npm run library -- --discover</code> with the dev
          server up to pull every eligible market (up to {LIMITS.libraryMaxMarkets.toLocaleString()}); until then these
          numbers are not reliable.
        </div>
      ) : null}
      <section className="audit-stats market-audit-stats">
        <div className="metric">
          <span>Empirical FDR (Placebo A)</span>
          <strong>{pct(c.placeboA.fdr, 1)}</strong>
          <small>
            {c.placeboA.meanFlags.toFixed(2)} twin flags ÷ {c.placeboA.realFlags} real flags · primary rule {pop.primary}
          </small>
        </div>
        <div className="metric">
          <span>Tested wallets (m)</span>
          <strong>{pop.family1.m.toLocaleString()}</strong>
          <small>
            {pop.wallets.toLocaleString()} wallets with bets · cutoff p ≤ {fmtP(pop.family1.cutoff)}
          </small>
        </div>
        <div className="metric">
          <span>Flagged (Test 1)</span>
          <strong>{pop.family1.flagged}</strong>
          <small>
            Tiers: {pop.tiers.map((t) => `${t.tier}: ${t.count}`).join(" · ")} · base rate {pct(pop.baseRate, 2)}
          </small>
        </div>
        <div className="metric">
          <span>Timing placebo</span>
          <strong>{c.timingPlacebo.meanFlags.toFixed(2)}</strong>
          <small>
            mean Test 2 flags vs {c.timingPlacebo.realFlags} real · {c.timingPlacebo.ok ? "passes" : "fails"}
          </small>
        </div>
      </section>
      <div className="analysis-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Positive control: what the audit catches</h2>
              <p>Injected wallets copying real price profiles, with true odds raised ×2 and ×4.</p>
            </div>
            <button className="outline-button" onClick={() => setRefresh((r) => r + 1)}>
              <RefreshCw size={14} /> Recompute
            </button>
          </div>
          <div className="table-scroll">
            <table className="records-table">
              <thead>
                <tr>
                  <th>Positions</th>
                  <th>Odds ×2</th>
                  <th>Odds ×4</th>
                </tr>
              </thead>
              <tbody>
                {WALLET_SETTINGS.injectedSizes.map((n) => {
                  const cell = (or: number) => c.positiveControl.find((x) => x.n === n && x.or === or);
                  return (
                    <tr key={n}>
                      <td>{n}</td>
                      <td>
                        {pct(cell(2)?.recall)}
                        <span className="cell-subline">{cell(2)?.injected ?? 0} injected</span>
                      </td>
                      <td>
                        {pct(cell(4)?.recall)}
                        <span className="cell-subline">{cell(4)?.injected ?? 0} injected</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="panel-footnote">This is the honest statement of what the audit can and cannot see.</p>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Negative control and Placebo B</h2>
              <p>Crypto-price markets, where private information is essentially impossible, versus study categories.</p>
            </div>
          </div>
          <dl className="integrity-formula">
            <div>
              <dt>Study flags / 1,000</dt>
              <dd>{c.negativeControl.study.per1000 === null ? "—" : c.negativeControl.study.per1000.toFixed(1)}</dd>
            </div>
            <div>
              <dt>Control flags / 1,000</dt>
              <dd>{c.negativeControl.control.per1000 === null ? "—" : c.negativeControl.control.per1000.toFixed(1)}</dd>
            </div>
            <div>
              <dt>Fisher exact p</dt>
              <dd>{fmtP(c.negativeControl.fisherP)}</dd>
            </div>
            <div>
              <dt>Placebo B flags</dt>
              <dd>
                {c.placeboB.flags} {c.placeboB.ok ? "(ok)" : "(check)"}
              </dd>
            </div>
          </dl>
          <div className="p-histogram" role="img" aria-label="Mid-p histogram under simulated outcomes">
            {c.placeboB.histogram.map((count, i) => (
              <div key={i}>
                <span>{count}</span>
                <i style={{ height: `${Math.max(2, (count / Math.max(1, ...c.placeboB.histogram)) * 90)}px` }} />
                <small>{(i / 10).toFixed(1)}</small>
              </div>
            ))}
          </div>
          <p className="panel-footnote">Placebo B redraws every outcome from its own q; a flat histogram means the arithmetic is right.</p>
        </section>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Calibration curve</h2>
            <p>
              Realized win rate by entry price (one observation per market and token), isotonic fit. Bins with fewer than{" "}
              {WALLET_SETTINGS.minMarketsPerBin} markets fall back to the raw price. q = max(p, c(p)).
            </p>
          </div>
        </div>
        <CalibrationChart bins={c.calibration} />
      </section>
    </>
  );
}

function CalibrationChart({ bins }: { bins: Check["check"]["calibration"] }) {
  const w = 640,
    h = 240,
    pad = 28,
    x = (p: number) => pad + p * (w - 2 * pad),
    y = (p: number) => h - pad - p * (h - 2 * pad);
  const fitted = bins.filter((b) => b.usesFit && b.meanPrice !== null);
  return (
    <svg className="integrity-chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Calibration curve against the diagonal">
      <line className="grid" x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} />
      {[0.25, 0.5, 0.75].map((g) => (
        <g key={g}>
          <line className="grid" x1={x(0)} x2={x(1)} y1={y(g)} y2={y(g)} />
          <text className="chart-label" x={4} y={y(g) + 4}>
            {Math.round(g * 100)}%
          </text>
        </g>
      ))}
      {bins
        .filter((b) => b.meanPrice !== null && b.winRate !== null)
        .map((b) => (
          <circle
            key={b.low}
            cx={x(b.meanPrice!)}
            cy={y(b.winRate!)}
            r={Math.max(2.5, Math.min(7, Math.sqrt(b.markets) / 2))}
            className={b.usesFit ? "cal-dot" : "cal-dot thin"}
          >
            <title>
              {Math.round(b.low * 100)}–{Math.round(b.high * 100)}¢: {(b.winRate! * 100).toFixed(1)}% won ({b.markets} markets)
            </title>
          </circle>
        ))}
      {fitted.length > 1 ? (
        <path className="price" d={`M${fitted.map((b) => `${x(b.meanPrice!).toFixed(1)},${y(b.fitted!).toFixed(1)}`).join("L")}`} />
      ) : null}
      <text className="chart-label" x={w - 90} y={h - 6}>
        entry price →
      </text>
    </svg>
  );
}

function Parameters() {
  const s = WALLET_SETTINGS;
  const wallet: [string, string, string][] = [
    ["Market window", `Markets resolved in the last ${SETTINGS.library.days} days, at least $${SETTINGS.library.minVolumeUsd.toLocaleString()} volume`, "Many repeat wallets; pullable in hours"],
    ["Study categories", SETTINGS.library.categories.filter((c) => c.id !== "control").map((c) => c.label).join("; "), "Where private information can exist"],
    ["Control category", "Crypto price markets", "Flags here are skill, speed or false positives"],
    ["Minimum position cost", `$${s.minCost}`, "Drops dust and airdrop farming"],
    ["Entry price range", `${s.priceRange[0] * 100}¢–${s.priceRange[1] * 100}¢ (first buy)`, "Above 95¢ is resolution sniping"],
    ["Late-trade cutoff", "Trades after the scheduled end are dropped", "Removes buying after the outcome is public"],
    ["Calibration", `0.02–0.05, then 5¢ bins; isotonic; ≥ ${s.minMarketsPerBin} markets per bin`, "Removes favorite–longshot bias"],
    ["Minimum positions", String(s.minPositions), "Fewer cannot clear the bar"],
    ["False discovery rate", String(s.alpha), "At most 1 in 20 flags expected to be luck"],
    ["Jumps", `+${s.jump.size * 100} points within ${s.jump.withinMinutes} min, keeps ≥ ${s.jump.persistFraction * 100}% for ${s.jump.persistHours} h, self-impact < ${s.jump.selfImpactShare * 100}%`, "A news shock, not drift or self-impact"],
    ["Pre-jump window", `${s.preJumpHours} hours`, "Matches leaks hours before announcements"],
    ["Placebo replicates", `${s.placeboRuns}, price match ±1¢ (±2¢ fallback)`, "Estimates the placebo flag count"],
    ["Injected edge", `odds ×${s.injectedOdds.join(" and ×")}`, "One modest and one strong edge"],
    ["Market verdict", `Exact binomial on flagged tested participants vs population rate; ≥ ${s.market.minTestedParticipants} tested; top ${s.market.maxParticipants} by volume`, "Verdict from wallets, not from market prices"],
  ];
  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Wallet method parameters (Advanced spec)</h2>
            <p>The Advanced spec defaults, unchanged. Later changes are listed below with their reasons.</p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="records-table">
            <thead>
              <tr>
                <th>Parameter</th>
                <th>Value</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {wallet.map(([name, value, why]) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td>{value}</td>
                  <td>{why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Change log</h2>
            <p>Every change after hour 1, with its reason.</p>
          </div>
        </div>
        <ul className="limitations-list">
          {CHANGE_LOG.map((c) => (
            <li key={c.change}>
              <strong>{c.change}</strong> {c.reason}
            </li>
          ))}
          <li>
            <strong>Library volume floor ($10k) and size (up to 5,000).</strong> Most smaller markets are untraded
            placeholders; size limits only change which markets enter the library.
          </li>
        </ul>
        <p className="panel-footnote">
          Pre-move context test (Market Integrity Search): {SETTINGS.windowHours}-hour window, {SETTINGS.minComparisonWindows}+
          comparison windows, aggressor-flow score. {DATA_CHECK.fillsAppearOnce}
        </p>
      </section>
    </>
  );
}
