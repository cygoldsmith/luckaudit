"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Info, LoaderCircle, RefreshCw, Search } from "lucide-react";
import AppFrame from "@/components/app-frame";
import { VERDICTS, WALLET_LABELS } from "@/components/integrity-panel";
import { requestJson } from "@/lib/client";
import { money, shortAddress } from "@/lib/domain";
import type { libraryStatus, methodCheck, multiReport } from "@/lib/integrity/data";
import { DATA_CHECK, LIMITS, SETTINGS } from "@/lib/integrity/settings";

type Multi = Awaited<ReturnType<typeof multiReport>>;
type Check = { check: Awaited<ReturnType<typeof methodCheck>> };
type Library = Awaited<ReturnType<typeof libraryStatus>>;
type Tab = "multi" | "check" | "settings";

const fmtP = (p: number | null | undefined) =>
  p === null || p === undefined ? "—" : p < 0.001 ? p.toExponential(1) : p.toFixed(3);
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
            <h1>Market integrity search</h1>
            <p>
              Was the buying in the 6 hours before a resolved market&apos;s big move unusually one-sided toward the side
              that then won? Every verdict carries its p-value, comparison count and measured false-alarm rate.
            </p>
          </div>
        </div>
        <div className="market-scope-banner">
          <Info size={17} />
          <span>
            <strong>An anomaly screen, not an accusation.</strong> Resolved markets only; wallets appear as shortened
            addresses. Library: {library ? `${library.built} of ${library.candidates} markets built, ${library.bets.toLocaleString()} wallet bets` : "loading…"}.
          </span>
        </div>
        <nav className="investigation-tabs" aria-label="Integrity sections">
          {(
            [
              ["multi", "Search several markets"],
              ["check", "Method check"],
              ["settings", "The nine settings"],
            ] as [Tab, string][]
          ).map(([value, label]) => (
            <button key={value} className={value === tab ? "selected" : ""} onClick={() => setTab(value)}>
              {label}
            </button>
          ))}
        </nav>
        {tab === "multi" ? <MultiSearch /> : null}
        {tab === "check" ? <MethodCheck library={library} /> : null}
        {tab === "settings" ? <SettingsTable /> : null}
      </main>
    </AppFrame>
  );
}

function MultiSearch() {
  const [mode, setMode] = useState<"paste" | "category">("paste"),
    [text, setText] = useState(""),
    [category, setCategory] = useState<string>("awards"),
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
      const body =
        mode === "paste"
          ? { conditions }
          : { category, ...(from ? { from } : {}), ...(to ? { to } : {}) };
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
              The market tests form one group corrected with Benjamini–Hochberg at 5%; every listed wallet is tested once
              across the whole search.
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
            {busy ? "Testing markets…" : "Run search"}
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
        <>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>
                  {result.rows.filter((r) => r.verdict === "unusual").length} of {result.M} testable markets flagged
                </h2>
                <p>
                  Pre-filter: M = {result.mSteps.join(" → ")} (each market needs at least 20 × M comparison windows). BH
                  bar for the last flagged rank: {fmtP(result.threshold)}. Sorted by q-value.
                </p>
              </div>
            </div>
            <div className="table-scroll">
              <table className="records-table">
                <thead>
                  <tr>
                    <th>Market</th>
                    <th>Verdict</th>
                    <th>p</th>
                    <th>q</th>
                    <th>Percentile</th>
                    <th>Unusual wallets</th>
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
                          {categoryLabel(r.category)} · {r.comparisonWindows.toLocaleString()} windows
                        </span>
                      </td>
                      <td>
                        <span className={`integrity-label verdict-${r.verdict}`}>{VERDICTS[r.verdict]}</span>
                      </td>
                      <td>{fmtP(r.p)}</td>
                      <td>{fmtP(r.q)}</td>
                      <td>
                        {r.percentile === null
                          ? r.belowFloor
                            ? "below $10k floor"
                            : "—"
                          : `${pct(r.percentile)} of ${r.compared}`}
                      </td>
                      <td>{r.flaggedWallets}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Wallet group</h2>
                <p>
                  {result.wallets.rows.length} distinct wallets, each tested once; records exclude every searched event.
                  {` ${result.wallets.correction} across ${result.wallets.tested} tested.`}
                </p>
              </div>
            </div>
            <div className="table-scroll">
              <table className="records-table">
                <thead>
                  <tr>
                    <th>Wallet</th>
                    <th>Markets</th>
                    <th>Record elsewhere</th>
                    <th>p / q</th>
                    <th>Label</th>
                  </tr>
                </thead>
                <tbody>
                  {result.wallets.rows
                    .filter((r) => r.label !== "too-few-bets")
                    .slice(0, 50)
                    .map((r) => (
                      <tr key={r.wallet}>
                        <td>
                          <Link className="evidence-link" href={`/wallet/${r.wallet}`}>
                            {shortAddress(r.wallet)}
                            <ArrowUpRight size={12} />
                          </Link>
                          <span className="cell-subline">{r.netUsd === null ? "" : money(r.netUsd)}</span>
                        </td>
                        <td>{r.markets.length}</td>
                        <td>
                          {r.record.wins} of {r.record.bets.length} won
                          <span className="cell-subline">{r.record.expected.toFixed(2)} expected</span>
                        </td>
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
            <p className="panel-footnote">
              {result.wallets.rows.filter((r) => r.label === "too-few-bets").length} wallets with fewer than{" "}
              {SETTINGS.walletRecord.minBets} other library bets are hidden.
            </p>
          </section>
        </>
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
    requestJson<Check>(`/api/integrity/method-check${refresh ? "?refresh=1" : ""}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Method check failed."));
  }, [refresh]);
  if (error) return <div className="inline-notice warning">{error}</div>;
  if (!data)
    return (
      <div className="loading-state" role="status">
        <LoaderCircle className="spin" size={27} />
        <p>Running the placebo tests on the library…</p>
      </div>
    );
  const c = data.check;
  return (
    <>
      {library && library.built < 50 ? (
        <div className="inline-notice warning">
          <Info size={15} />
          Only {library.built} library markets are built. Run <code>npm run library -- --discover</code> with the dev
          server up to pull the full sample ({LIMITS.libraryMaxMarkets} markets); until then these rates are not reliable.
        </div>
      ) : null}
      <section className="audit-stats market-audit-stats">
        <div className="metric">
          <span>Random-time placebo</span>
          <strong>{pct(c.randomTime.share, 1)}</strong>
          <small>
            fake p ≤ 0.05 across {c.randomTime.markets} markets × {c.randomTime.runs} runs (target ≈ 5%)
          </small>
        </div>
        <div className="metric">
          <span>Multi-market flags on fake times</span>
          <strong>{c.randomTime.meanMultiFlags === null ? "—" : c.randomTime.meanMultiFlags.toFixed(2)}</strong>
          <small>average BH flags per run, within categories</small>
        </div>
        <div className="metric">
          <span>Fake-wallet false-flag rate</span>
          <strong>{pct(c.fakeWallet.falseFlagRate, 1)}</strong>
          <small>
            {c.fakeWallet.meanFakeFlags.toFixed(2)} fake ÷ {c.fakeWallet.realFlags} real flags · wallet bar:{" "}
            {c.fakeWallet.correction}
          </small>
        </div>
        <div className="metric">
          <span>Power (planted buying)</span>
          <strong>
            {pct(c.plantedBuying[0].power)} / {pct(c.plantedBuying[1].power)}
          </strong>
          <small>switch to unusual at 1× / 3× cushion, {c.plantedBuying[0].markets} markets</small>
        </div>
      </section>
      <div className="analysis-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>By category</h2>
              <p>A category whose random-time rate exceeds 10% is not calibrated; its market verdicts are withheld.</p>
            </div>
            <button className="outline-button" onClick={() => setRefresh((r) => r + 1)}>
              <RefreshCw size={14} /> Recompute
            </button>
          </div>
          <div className="table-scroll">
            <table className="records-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Placebo rate</th>
                  <th>Observed p ≤ 0.05</th>
                  <th>Excess unusual pre-move buying</th>
                </tr>
              </thead>
              <tbody>
                {SETTINGS.library.categories.map((cat) => {
                  const r = c.randomTime.categories[cat.id],
                    e = c.excess[cat.id];
                  return (
                    <tr key={cat.id}>
                      <td>{cat.label}</td>
                      <td>
                        {pct(r?.rate, 1)}
                        <span className="cell-subline">
                          {r ? (r.calibrated ? "calibrated" : "not calibrated") : "no data"}
                        </span>
                      </td>
                      <td>
                        {e ? pct(e.observedRate, 1) : "—"}
                        <span className="cell-subline">{e ? `${e.markets} testable` : ""}</span>
                      </td>
                      <td>
                        {e && e.excess !== undefined
                          ? `${pct(e.excess, 1)} (${pct(e.low, 1)} to ${pct(e.high, 1)})`
                          : "—"}
                        <span className="cell-subline">
                          {e && e.evidence === false ? "no evidence of more than chance" : ""}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="panel-footnote">
            Excess = observed rate − placebo rate, with a 95% margin on the observed rate. It is the share of markets whose
            pre-move buying was more one-sided than chance explains, not a rate of insider trading.
          </p>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Price-bucket check</h2>
              <p>How often library bets in each price bucket actually won (each market once per bucket).</p>
            </div>
          </div>
          <div className="table-scroll">
            <table className="records-table">
              <thead>
                <tr>
                  <th>Price</th>
                  <th>Markets</th>
                  <th>Win rate</th>
                </tr>
              </thead>
              <tbody>
                {c.calibration.buckets.map((b) => (
                  <tr key={b.low}>
                    <td>
                      {Math.round(b.low * 100)}–{Math.round(b.high * 100)}¢
                    </td>
                    <td>{b.markets}</td>
                    <td>{pct(b.winRate, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="panel-footnote">Each bet&apos;s fair chance is the higher of its price and its bucket&apos;s win rate.</p>
        </section>
      </div>
    </>
  );
}

function SettingsTable() {
  const s = SETTINGS;
  const rows: [string, string, string][] = [
    ["Reference library", `Markets resolved in the last ${s.library.days} days with at least $${s.library.minVolumeUsd.toLocaleString()} lifetime volume: ${s.library.categories.map((c) => `${c.label} (${c.tagSlugs.join(", ")})`).join("; ")}`, "Topics where someone could know the answer early"],
    ["Big move", `Largest one-hour Yes change ≥ ${s.bigMove.minChange * 100} points, keeping ≥ ${s.bigMove.persistFraction * 100}% ${s.bigMove.persistHours} hours later (or resolving that way); no wallet > ${s.bigMove.maxSingleWalletShare * 100}% of the hour's dollars`, "A sudden, lasting jump is the footprint of news"],
    ["Pre-move window", `${s.windowHours} hours before the move`, "Close to the news, long enough to catch early buying"],
    ["Minimum history", `${s.minComparisonWindows} earlier ${s.windowHours}-hour windows`, "Fewer windows make the p-value too coarse"],
    ["One-sidedness score", `${s.score.type === "aggressor-flow" ? "Aggressor flow" : "Price drift"}; cushion = median comparison-window volume, floor $${s.score.cushionFloor}`, DATA_CHECK.aggressorIdentifiable],
    ["Wallets listed", `Top ${s.walletList.count} by net dollars behind the favored side, min $${s.walletList.minNetUsd}`, "The people most worth looking at"],
    ["Wallet record rules", `Bets ≥ $${s.walletRecord.minCost}, ${s.walletRecord.minPrice * 100}¢–${s.walletRecord.maxPrice * 100}¢, ≥ ${s.walletRecord.minBets} bets, library markets outside this event`, "Applied only to other markets"],
    ["Error budget", `${s.alpha * 100}%: p ≤ ${s.alpha} for one market; ${s.alpha * 100}% FDR for any group`, "One standard for every verdict"],
    ["Placebo runs", String(s.placeboRuns), "Enough repeats to measure the false-alarm rate"],
  ];
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Prespecified settings</h2>
          <p>
            Committed before running on real markets. Only #5 depends on data — the data format — decided by the hour-1
            check on {DATA_CHECK.checkedAt}.
          </p>
        </div>
      </div>
      <div className="table-scroll">
        <table className="records-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Setting</th>
              <th>Value</th>
              <th>Why</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, value, why], i) => (
              <tr key={name}>
                <td>{i + 1}</td>
                <td>{name}</td>
                <td>{value}</td>
                <td>{why}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="panel-footnote">Data check: {DATA_CHECK.fillsAppearOnce}</p>
    </section>
  );
}
