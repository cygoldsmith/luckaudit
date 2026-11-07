"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Bookmark,
  Check,
  Copy,
  Download,
  ExternalLink,
  FileSearch,
  FlaskConical,
  Info,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { SiteHeader } from "./app-frame";
import { ProfitChart, WinsChart } from "./audit-charts";
import { RECORD_LABELS } from "@/lib/analysis";
import { DISCLAIMER } from "./integrity-panel";
import { EDGE_LABELS, TIER_LABELS } from "@/lib/integrity/wallet-spec";
import WalletPrimaryMarkets from "./wallet-primary-markets";
import {
  csv,
  download,
  markRecent,
  readStore,
  requestJson,
  saveTrader,
} from "@/lib/client";
import {
  compact,
  dateTime,
  isFiniteNumber,
  marketLink,
  money,
  shortAddress,
  txLink,
  type Audit,
  type Investigation,
  type Report,
  type Trader,
} from "@/lib/domain";
type Tab = "overview" | "markets" | "trades" | "record" | "report";
const badgeClass = (label: string) =>
  label === "unusual-record" ? "unusual" : label === "nothing-unusual" ? "within-baseline" : "insufficient";
const fmtP = (p: number | null) => (p === null ? "—" : p < 0.001 ? p.toExponential(1) : p.toFixed(3));
export default function WalletInvestigation({
  address,
  initialSnapshot = false,
}: {
  address: string;
  initialSnapshot?: boolean;
}) {
  const [data, setData] = useState<Investigation | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [tab, setTab] = useState<Tab>("overview");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("positions");
  const [positionFilter, setPositionFilter] = useState("all");
  const [token, setToken] = useState("");
  const [page, setPage] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [actionError, setActionError] = useState("");
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setError("");
    setData(null);
    requestJson<Investigation>(
      `/api/wallet/${address}?snapshot=${snapshot ? 1 : 0}&refresh=${refresh ? 1 : 0}`,
      { signal: c.signal },
    )
      .then((result) => {
        if (!c.signal.aborted) {
          setData(result);
          const trader: Trader = {
            address,
            name: result.bundle.trades[0]?.name || shortAddress(address),
            rank: 0,
            pnl: null,
            volume: null,
            verified: false,
          };
          markRecent(trader);
          setSaved(readStore().saved.some((t) => t.address === address));
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [address, refresh, snapshot]);
  useEffect(() => {
    setPage(0);
  }, [query, mode, positionFilter, token]);
  const bundle = data?.bundle,
    audit = data?.audit,
    rec = audit?.record;
  const name = bundle?.trades[0]?.name || shortAddress(address);
  const trader: Trader = {
    address,
    name,
    rank: 0,
    pnl: null,
    volume: null,
    verified: false,
  };
  const reviews = new Map(audit?.reviews.map((r) => [r.token, r]) || []);
  const positions = (bundle?.positions || []).filter(
    (p) =>
      (!token || p.token_id === token) &&
      `${p.title} ${p.outcome}`.toLowerCase().includes(query.toLowerCase()) &&
      (positionFilter === "all" ||
        (positionFilter === "eligible" && reviews.get(p.token_id)?.eligible) ||
        (positionFilter === "closed" && p.status === "CLOSED") ||
        (positionFilter === "open" && p.status !== "CLOSED")),
  );
  const fills = (bundle?.trades || []).filter(
    (t) =>
      (!token || t.token_id === token) &&
      `${t.title} ${t.outcome} ${t.transaction_hash}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const count = mode === "positions" ? positions.length : fills.length;
  const pages = Math.max(1, Math.ceil(count / 30));
  const currentPage = Math.min(page, pages - 1);
  function focusEvidence(id: string) {
    const bet = audit?.bets.find((b) => b.id === id);
    if (!bet) return;
    setToken(bet.token);
    setQuery("");
    setMode("fills");
    setTab("trades");
    setPage(0);
  }
  async function generate() {
    const fetchedAt = bundle?.provenance.fetchedAt;
    setGenerating(true);
    setActionError("");
    try {
      const result = await requestJson<{ report: Report }>(
        `/api/wallet/${address}/report?snapshot=${snapshot ? 1 : 0}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fetchedAt }),
        },
      );
      setData((current) =>
        current &&
        current.bundle.address === address &&
        current.bundle.provenance.fetchedAt === fetchedAt
          ? { ...current, report: result.report }
          : current,
      );
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "AI report failed");
    } finally {
      setGenerating(false);
    }
  }
  function exportTrades() {
    if (!bundle) return;
    download(
      `luckaudit-${address}-fills.csv`,
      csv([
        ["Source", bundle.provenance.origin],
        ["Retrieved", bundle.provenance.fetchedAt],
        [
          "Timestamp",
          "Market",
          "Outcome",
          "Side",
          "Shares",
          "Execution price USD",
          "Notional USD (excludes fees)",
          "Transaction",
        ],
        ...fills.map((t) => [
          new Date(t.timestamp * 1000).toISOString(),
          t.title,
          t.outcome,
          t.side,
          t.size,
          t.price,
          t.size * t.price,
          t.transaction_hash,
        ]),
      ]),
      "text/csv;charset=utf-8",
    );
  }
  return (
    <div className="site investigation-shell">
      <SiteHeader active="wallet" />
      <main className="investigation-main">
        <div className="breadcrumbs">
          <Link href="/">Markets</Link>
          <span>/</span>
          <span>Wallet investigation</span>
        </div>
        <div className="page-heading">
          <div>
            <div className="eyebrow">WALLET INVESTIGATION</div>
            <h1>{loading ? shortAddress(address) : name}</h1>
            <div className="investigation-address">
              <span>{address}</span>
              <button
                className="icon-button"
                aria-label="Copy wallet address"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(address);
                    setCopied(true);
                  } catch {
                    setActionError("Select the address to copy it.");
                  }
                }}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          </div>
          <div className="heading-actions">
            <a
              className="text-button"
              href={`https://polymarket.com/profile/${address}`}
              target="_blank"
              rel="noreferrer"
            >
              Polymarket profile
              <ExternalLink size={13} />
            </a>
            <button
              className="outline-button"
              disabled={!data}
              onClick={() => {
                setSaved(
                  saveTrader(trader).saved.some((t) => t.address === address),
                );
              }}
            >
              <Bookmark size={14} fill={saved ? "currentColor" : "none"} />
              {saved ? "Saved" : "Save trader"}
            </button>
            <button
              className="primary-button"
              disabled={!data}
              onClick={() =>
                download(
                  `luckaudit-${address}-report.json`,
                  JSON.stringify(data, null, 2),
                  "application/json",
                )
              }
            >
              <Download size={14} />
              Export report
            </button>
          </div>
        </div>
        <div className="source-bar">
          <span
            className={`source-pill ${bundle?.provenance.origin === "snapshot" ? "is-snapshot" : ""}`}
          >
            <span className="tiny-dot" />
            {loading
              ? "Retrieving records"
              : bundle?.provenance.origin || "Unavailable"}
          </span>
          <span>
            {bundle
              ? dateTime(bundle.provenance.fetchedAt)
              : "Trades, positions, payouts, and historical P&L"}
          </span>
          <div className="source-actions">
            <label className="sr-only" htmlFor="wallet-mode">
              Wallet data mode
            </label>
            <select
              id="wallet-mode"
              value={snapshot ? "snapshot" : "live"}
              onChange={(e) => setSnapshot(e.target.value === "snapshot")}
            >
              <option value="live">Live data</option>
              <option value="snapshot">Saved snapshot</option>
            </select>
            <button
              className="icon-button"
              aria-label="Refresh wallet data"
              disabled={loading}
              onClick={() => setRefresh((x) => x + 1)}
            >
              <RefreshCw size={15} className={loading ? "spin" : ""} />
            </button>
          </div>
        </div>
        {loading ? (
          <div className="loading-state investigation-loading" role="status">
            <LoaderCircle className="spin" size={28} />
            <h2>Retrieving and verifying public records</h2>
            <p>
              Fetching trading history, reconciling positions, checking final
              payouts, and running the exact record test. Large wallets use a bounded
              history scan.
            </p>
          </div>
        ) : error ? (
          <div className="empty-state" role="alert">
            <Info size={28} />
            <h2>Investigation unavailable</h2>
            <p>{error}</p>
            <button
              className="outline-button"
              onClick={() => setRefresh((x) => x + 1)}
            >
              Retry
              <RefreshCw size={14} />
            </button>
          </div>
        ) : data && bundle && audit ? (
          <>
            {bundle.provenance.warning ? (
              <div className="inline-notice">
                <Info size={16} />
                {bundle.provenance.warning}
              </div>
            ) : null}
            {bundle.coverage.warnings.length ? (
              <div className="inline-notice warning">
                <Info size={16} />
                <div>
                  <strong>Partial data coverage</strong>
                  <p>{bundle.coverage.warnings.join(" ")}</p>
                </div>
              </div>
            ) : null}
            <nav
              className="investigation-tabs"
              aria-label="Investigation sections"
            >
              {(
                [
                  "overview",
                  "markets",
                  "trades",
                  "record",
                  "report",
                ] as Tab[]
              ).map((value) => (
                <button
                  key={value}
                  className={tab === value ? "selected" : ""}
                  aria-current={tab === value ? "page" : undefined}
                  onClick={() => {
                    setTab(value);
                    setActionError("");
                  }}
                >
                  {value === "overview"
                    ? "Overview"
                    : value === "markets"
                      ? "Primary markets"
                      : value === "trades"
                        ? "Positions & trades"
                        : value === "record"
                          ? "Record test"
                          : "Investigation report"}
                  {value === "trades" ? (
                    <span>{bundle.positions.length}</span>
                  ) : null}
                </button>
              ))}
            </nav>
            {actionError ? (
              <div className="inline-notice warning" role="alert">
                <Info size={15} />
                {actionError}
              </div>
            ) : null}
            {tab === "overview" ? (
              <>
                <section className="audit-stats">
                  <Metric
                    title="All-time API realized P&L"
                    value={money(bundle.stats?.all_time_pnl?.realized_pnl)}
                    note="API profile ledger; includes other position types"
                  />
                  <Metric
                    title="Loaded positions"
                    value={compact(audit.summary.positions)}
                    note={`${audit.summary.closed} closed · ${audit.summary.positions - audit.summary.closed} other`}
                  />
                  <Metric
                    title="Bets in the record"
                    value={String(audit.summary.eventGroups)}
                    note={`${audit.summary.eligible} qualifying positions; largest per event counted`}
                  />
                  <Metric
                    title="Actual / expected wins"
                    value={rec && rec.observations ? `${rec.wins} / ${rec.expected.toFixed(2)}` : "—"}
                    note="Expected = sum of fair chances"
                  />
                  <Metric
                    title="Luck ratio"
                    value={rec?.luckRatio != null ? rec.luckRatio.toFixed(1) : "—"}
                    note="Actual ÷ expected wins (size of the edge)"
                  />
                  <Metric
                    title="Exact p-value"
                    value={rec ? fmtP(rec.p) : "—"}
                    note={`Single-wallet bar ${rec?.alpha ?? 0.05}; not selection-adjusted`}
                  />
                </section>
                <div className="analysis-grid">
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>Historical trading P&L</h2>
                        <p>Cumulative API trading series · USD</p>
                      </div>
                      <AudioMark />
                    </div>
                    <ProfitChart points={bundle.pnl} />
                    <p className="panel-footnote">
                      Historical source observations may be daily. Missing
                      values remain gaps. This series differs from the
                      leaderboard’s period P&L.
                    </p>
                  </section>
                  <section className="panel assessment-panel">
                    <span
                      className={`assessment-badge ${badgeClass(rec?.label || "too-few-bets")}`}
                    >
                      <ShieldCheck size={14} />
                      {rec ? RECORD_LABELS[rec.label] : "Not tested"}
                    </span>
                    <h2>{data.report.headline}</h2>
                    <p>
                      {rec?.reasons.length
                        ? rec.reasons.join(" ")
                        : "Unusual means hard to explain by luck given the prices paid. It cannot tell skill, fast reading of public news, and nonpublic information apart."}
                    </p>
                    <button
                      className="outline-button"
                      onClick={() => setTab("record")}
                    >
                      Inspect the record test
                      <ArrowRight size={14} />
                    </button>
                    <button
                      className="text-button"
                      onClick={() => setTab("report")}
                    >
                      Read the evidence report
                      <ArrowUpRight size={14} />
                    </button>
                  </section>
                </div>
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Coverage & eligibility</h2>
                      <p>Only resolved positions meeting the bet rules enter the record.</p>
                    </div>
                  </div>
                  <div className="coverage-grid">
                    {Object.entries(bundle.coverage)
                      .filter(([key]) => key !== "warnings")
                      .map(([key, value]) => (
                        <div key={key}>
                          <span>{key[0].toUpperCase() + key.slice(1)}</span>
                          <strong className={value ? "positive" : "negative"}>
                            {value ? "Retrieved" : "Partial"}
                          </strong>
                        </div>
                      ))}
                  </div>
                  <div className="pipeline-stats">
                    <span>{bundle.trades.length.toLocaleString()} fills</span>
                    <ArrowRight size={14} />
                    <span>{audit.summary.positions} positions</span>
                    <ArrowRight size={14} />
                    <span>{audit.summary.eligible} qualifying bets</span>
                    <ArrowRight size={14} />
                    <strong>
                      {audit.summary.eventGroups} bets in the record
                    </strong>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => setTab("trades")}
                  >
                    See every inclusion and exclusion
                    <ArrowUpRight size={14} />
                  </button>
                </section>
              </>
            ) : null}
            {tab === "markets" ? (
              <WalletPrimaryMarkets bundle={bundle} />
            ) : null}
            {tab === "trades" ? (
              <section className="panel positions-panel">
                <div className="panel-heading">
                  <div>
                    <h2>Positions & transaction evidence</h2>
                    <p>Reported API P&L is not adjusted again for fees.</p>
                  </div>
                  <button className="outline-button" onClick={exportTrades}>
                    <Download size={14} />
                    Export fills
                  </button>
                </div>
                <div className="evidence-filters">
                  <div className="period-control">
                    <button
                      className={mode === "positions" ? "selected" : ""}
                      onClick={() => setMode("positions")}
                    >
                      Positions
                    </button>
                    <button
                      className={mode === "fills" ? "selected" : ""}
                      onClick={() => setMode("fills")}
                    >
                      Fills
                    </button>
                  </div>
                  <label className="table-search">
                    <Search size={15} />
                    <input
                      aria-label="Search market records"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search market or outcome…"
                    />
                  </label>
                  {mode === "positions" ? (
                    <select
                      aria-label="Position status filter"
                      value={positionFilter}
                      onChange={(e) => setPositionFilter(e.target.value)}
                    >
                      <option value="all">All positions</option>
                      <option value="eligible">Eligible positions</option>
                      <option value="closed">Closed positions</option>
                      <option value="open">Other positions</option>
                    </select>
                  ) : null}
                  {token ? (
                    <button
                      className="outline-button"
                      onClick={() => setToken("")}
                    >
                      Clear evidence filter
                    </button>
                  ) : null}
                </div>
                <div className="table-scroll">
                  <table className="records-table">
                    <thead>
                      {mode === "positions" ? (
                        <tr>
                          <th>Market / outcome</th>
                          <th>Avg entry</th>
                          <th>Realized P&L</th>
                          <th>State</th>
                          <th>Model eligibility</th>
                        </tr>
                      ) : (
                        <tr>
                          <th>Market / outcome</th>
                          <th>Side</th>
                          <th>Entry price</th>
                          <th>Shares / notional</th>
                          <th>Time / evidence</th>
                        </tr>
                      )}
                    </thead>
                    <tbody>
                      {mode === "positions"
                        ? positions
                            .slice(currentPage * 30, (currentPage + 1) * 30)
                            .map((p) => {
                              const review = reviews.get(p.token_id),
                                bet = audit.bets.find(
                                  (b) => b.token === p.token_id,
                                );
                              return (
                                <tr key={p.token_id}>
                                  <td className="market-cell">
                                    <a
                                      href={marketLink(p.event_slug || p.slug)}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      {p.title || shortAddress(p.condition_id)}
                                      <ArrowUpRight size={12} />
                                    </a>
                                    <span>{p.outcome}</span>
                                  </td>
                                  <td>
                                    {p.avg_price !== null
                                      ? `${(p.avg_price * 100).toFixed(1)}%`
                                      : "—"}
                                  </td>
                                  <td
                                    className={
                                      p.realized_pnl !== null &&
                                      p.realized_pnl < 0
                                        ? "negative"
                                        : "positive"
                                    }
                                  >
                                    {money(p.realized_pnl)}
                                  </td>
                                  <td>
                                    <span className="audit-status">
                                      {p.status}
                                    </span>
                                  </td>
                                  <td className="eligibility-cell">
                                    {review?.eligible ? (
                                      <button
                                        className="evidence-link"
                                        onClick={() =>
                                          focusEvidence(review.evidenceId!)
                                        }
                                      >
                                        {review.evidenceId} ·{" "}
                                        {bet?.selected
                                          ? "Counted"
                                          : "Smaller bet in the same event"}
                                        <ArrowUpRight size={12} />
                                      </button>
                                    ) : (
                                      <span>
                                        {review?.reason || "Not evaluated"}
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })
                        : fills
                            .slice(currentPage * 30, (currentPage + 1) * 30)
                            .map((t, i) => (
                              <tr
                                key={`${t.transaction_hash}-${t.token_id}-${i}`}
                              >
                                <td className="market-cell">
                                  <a
                                    href={marketLink(t.event_slug || t.slug)}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {t.title || shortAddress(t.condition_id)}
                                    <ArrowUpRight size={12} />
                                  </a>
                                  <span>{t.outcome}</span>
                                </td>
                                <td>{t.side}</td>
                                <td>{(t.price * 100).toFixed(2)}¢</td>
                                <td>
                                  {compact(t.size)} shares
                                  <span className="cell-subline">
                                    {money(t.price * t.size)} excluding fees
                                  </span>
                                </td>
                                <td>
                                  <span className="cell-subline">
                                    {dateTime(t.timestamp)}
                                  </span>
                                  {/^0x[\da-f]{64}$/i.test(
                                    t.transaction_hash,
                                  ) ? (
                                    <a
                                      className="evidence-link"
                                      href={txLink(t.transaction_hash)}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      Transaction
                                      <ExternalLink size={12} />
                                    </a>
                                  ) : (
                                    "Hash unavailable"
                                  )}
                                </td>
                              </tr>
                            ))}
                    </tbody>
                  </table>
                </div>
                {!count ? (
                  <div className="empty-state">
                    <Search size={23} />
                    <h3>No records in this view</h3>
                    <p>Try another filter or market name.</p>
                  </div>
                ) : null}
                <div className="table-footer">
                  <span>
                    {count
                      ? `${currentPage * 30 + 1}–${Math.min((currentPage + 1) * 30, count)} of ${count} records`
                      : "0 records"}
                  </span>
                  <div className="pagination">
                    <button
                      disabled={currentPage === 0}
                      onClick={() => setPage((x) => x - 1)}
                      aria-label="Previous records"
                    >
                      ←
                    </button>
                    <span>
                      {currentPage + 1} / {pages}
                    </span>
                    <button
                      disabled={currentPage >= pages - 1}
                      onClick={() => setPage((x) => x + 1)}
                      aria-label="Next records"
                    >
                      →
                    </button>
                  </div>
                </div>
              </section>
            ) : null}
            {tab === "record" ? (
              <>
                {data.library ? <LibraryCard library={data.library} /> : null}
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Wallet record test</h2>
                      <p>
                        Bets of $10 or more priced 3¢–50¢, held to resolution, one per event · exact Poisson-binomial
                      </p>
                    </div>
                    <span className={`assessment-badge ${badgeClass(audit.record.label)}`}>
                      <ShieldCheck size={14} />
                      {RECORD_LABELS[audit.record.label]}
                    </span>
                  </div>
                  {audit.record.observations ? (
                    <>
                      <WinsChart record={audit.record} />
                      <div className="simulation-metrics">
                        <Metric
                          title="Actual / expected wins"
                          value={`${audit.record.wins} / ${audit.record.expected.toFixed(2)}`}
                          note={`${audit.record.observations} bets in different events`}
                        />
                        <Metric
                          title="Exact p-value"
                          value={fmtP(audit.record.p)}
                          note={`Chance of at least ${audit.record.wins} wins with no edge`}
                        />
                        <Metric
                          title="Luck ratio"
                          value={audit.record.luckRatio === null ? "—" : audit.record.luckRatio.toFixed(1)}
                          note="How big the edge is, separate from how sure we are"
                        />
                      </div>
                      <div className="simulation-interval">
                        <span>
                          Bar (one wallet = one test)<strong>{audit.record.alpha}</strong>
                        </span>
                        <span>
                          Win-every-bet chance<strong>{fmtP(audit.record.allWinChance)}</strong>
                        </span>
                        <span>
                          Without most surprising win
                          <strong>
                            {audit.record.fragileP === null
                              ? "—"
                              : `${fmtP(audit.record.fragileP)}${audit.record.fragile ? " · depends on one bet" : ""}`}
                          </strong>
                        </span>
                        <span>
                          Fair chances
                          <strong>
                            {audit.record.calibration === "library"
                              ? `price-bucket check (${audit.record.calibrationMarkets})`
                              : "price only (no library yet)"}
                          </strong>
                        </span>
                      </div>
                      {audit.record.reasons.length ? (
                        <div className="inline-notice warning">
                          <Info size={16} />
                          <span>{audit.record.reasons.join(" ")}</span>
                        </div>
                      ) : null}
                      <div className="inline-notice">
                        <Info size={16} />
                        <span>
                          Each wallet search is its own test. Checking many wallets one at a time and pointing to the
                          unusual one skips the correction; the market page&apos;s participant scan and the integrity
                          search test wallets together with Benjamini–Hochberg.
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="empty-state">
                      <FlaskConical size={27} />
                      <h3>No qualifying bets</h3>
                      <p>No resolved position met the bet rules. Inspect the position exclusions to see why.</p>
                      <button className="outline-button" onClick={() => setTab("trades")}>
                        Inspect positions
                        <ArrowRight size={14} />
                      </button>
                    </div>
                  )}
                </section>
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Bets in the record</h2>
                      <p>Click an evidence ID to inspect its purchase fills.</p>
                    </div>
                  </div>
                  <div className="evidence-list">
                    {audit.bets
                      .filter((b) => b.selected)
                      .map((b) => (
                        <div key={b.id}>
                          <button
                            className="evidence-id"
                            onClick={() => focusEvidence(b.id)}
                          >
                            {b.id}
                          </button>
                          <div>
                            <strong>{b.title}</strong>
                            <span>
                              {b.outcome} · {(b.price * 100).toFixed(1)}¢ avg price ·{" "}
                              {(b.probability * 100).toFixed(1)}% fair chance · {b.won ? "Won" : "Lost"} ·{" "}
                              {dateTime(b.firstEntry)}
                            </span>
                          </div>
                          <strong
                            className={b.pnl < 0 ? "negative" : "positive"}
                          >
                            {money(b.pnl)}
                          </strong>
                          <a
                            className="icon-button"
                            aria-label={`Open market for ${b.id}`}
                            href={marketLink(b.slug)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <ExternalLink size={14} />
                          </a>
                        </div>
                      ))}
                  </div>
                  {!audit.bets.some((b) => b.selected) ? (
                    <p className="dialog-description">
                      No qualifying bets.
                    </p>
                  ) : null}
                </section>
                <section className="panel">
                  <h2>Assumptions & limitations</h2>
                  <ul className="limitations-list">
                    {audit.limitations.map((text) => (
                      <li key={text}>{text}</li>
                    ))}
                  </ul>
                </section>
              </>
            ) : null}
            {tab === "report" ? (
              <>
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <span className="report-mode">
                        <FileSearch size={14} />
                        {data.report.mode === "ai"
                          ? "Local AI · computed evidence"
                          : "Statistical evidence report"}
                      </span>
                      <h2>{data.report.headline}</h2>
                      <p>
                        Generated {dateTime(data.report.generatedAt)}
                        {data.report.model
                          ? ` · ${data.report.model}`
                          : " · deterministic calculations, no LLM"}
                      </p>
                    </div>
                    <button
                      className="primary-button"
                      disabled={!data.aiConfigured || generating}
                      onClick={generate}
                    >
                      {generating ? (
                        <LoaderCircle className="spin" size={14} />
                      ) : (
                        <Sparkles size={14} />
                      )}{" "}
                      {generating ? "Generating…" : "Generate local AI report"}
                    </button>
                  </div>
                  {!data.aiConfigured ? (
                    <div className="inline-notice">
                      <Info size={15} />
                      Local AI is unavailable. Start Ollama with an installed
                      model to generate an explanation. The statistical report
                      below remains available.
                    </div>
                  ) : null}
                  <div className="report-findings">
                    {data.report.findings.map((finding, i) => (
                      <article key={i}>
                        <h3>{finding.title}</h3>
                        <p>{finding.text}</p>
                        {finding.evidenceIds.length ? (
                          <div className="report-citations">
                            {finding.evidenceIds.map((id) => (
                              <button
                                key={id}
                                onClick={() => focusEvidence(id)}
                              >
                                {id}
                                <ArrowUpRight size={11} />
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </article>
                    ))}
                  </div>
                </section>
                <div className="analysis-grid">
                  <section className="panel">
                    <h2>Alternative explanations</h2>
                    <ul className="limitations-list">
                      {data.report.alternatives.map((text) => (
                        <li key={text}>{text}</li>
                      ))}
                    </ul>
                  </section>
                  <section className="panel">
                    <h2>Limitations</h2>
                    <ul className="limitations-list">
                      {data.report.limitations.map((text) => (
                        <li key={text}>{text}</li>
                      ))}
                    </ul>
                  </section>
                </div>
              </>
            ) : null}
            <footer className="page-footer">
              <span>
                Source: public Polymarket Data API · No finding establishes
                insider trading
              </span>
              <a
                href="https://data-api.polymarket.com/v2/docs"
                target="_blank"
                rel="noreferrer"
              >
                API methodology
                <ArrowUpRight size={13} />
              </a>
            </footer>
          </>
        ) : null}
      </main>
    </div>
  );
}
function Metric({
  title,
  value,
  note,
}: {
  title: string;
  value: string;
  note: string;
}) {
  return (
    <div className="metric">
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}
function AudioMark() {
  return <span className="chart-source-label">API history</span>;
}

function LibraryCard({ library }: { library: NonNullable<Investigation["library"]> }) {
  const c = library.card;
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Population wallet card (Advanced spec)</h2>
          <p>
            {c
              ? `Tested against ${library.tested.toLocaleString()} wallets in the library, ${library.primary} at 5%.`
              : "This wallet has no positions in the library markets built so far."}
            {library.empiricalFdr !== null ? ` Measured false-flag rate ${(library.empiricalFdr * 100).toFixed(1)}%.` : ""}
          </p>
        </div>
        {c ? (
          <span className={`assessment-badge ${c.tier === 1 || c.tier === 2 ? "unusual" : c.tier === 3 ? "insufficient" : "within-baseline"}`}>
            <ShieldCheck size={14} />
            {!c.tested1 ? "Not tested" : TIER_LABELS[c.tier]}
          </span>
        ) : null}
      </div>
      {c ? (
        <>
          <div className="simulation-metrics">
            <Metric title="Record" value={`${c.O} / ${c.n}`} note={`${c.E.toFixed(2)} expected wins`} />
            <Metric
              title="Test 1 p / q"
              value={fmtP(c.p1)}
              note={`q ${fmtP(c.q1)}${c.byRobust ? " · BY-robust" : ""}${c.loeo === null ? "" : c.loeo ? " · LOEO pass" : " · LOEO fail"}`}
            />
            <Metric
              title="Odds multiplier"
              value={c.odds === null ? "—" : c.odds === Infinity ? `all ${c.n} won` : `×${c.odds.toFixed(1)}`}
              note={EDGE_LABELS[c.edge]}
            />
            <Metric title="Test 2 timing" value={`${c.K} vs ${c.EK.toFixed(1)}`} note={`p ${fmtP(c.p2)} · q ${fmtP(c.q2)}`} />
          </div>
          {c.top.length ? (
            <div className="evidence-list">
              {c.top.map((b, i) => (
                <div key={i}>
                  <span className="evidence-id">{b.won ? "Won" : "Lost"}</span>
                  <div>
                    <strong>{b.title}</strong>
                    <span>
                      entry {(b.p * 100).toFixed(1)}¢ · null {(b.q * 100).toFixed(1)}% · {dateTime(b.t)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          <p className="panel-footnote">{DISCLAIMER} Money: cost {money(c.cost)}, profit {money(c.profit)} (severity only, not used in detection).</p>
        </>
      ) : null}
    </section>
  );
}
