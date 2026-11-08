"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Download,
  ExternalLink,
  FileSearch,
  Info,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import AppFrame from "./app-frame";
import PriceTimeline from "./price-timeline";
import IntegrityPanel from "./integrity-panel";
import { MarketReportTab } from "./plain-report";
import { RECORD_LABELS } from "@/lib/analysis";
import { download, requestJson } from "@/lib/client";
import {
  compact,
  dateTime,
  money,
  shortAddress,
  txLink,
  type Report,
} from "@/lib/domain";
import type {
  MarketInvestigation as Investigation,
  ParticipantAudit,
} from "@/lib/market-types";
type Tab = "integrity" | "overview" | "activity" | "traders" | "report";
export default function MarketInvestigation({
  condition,
  initialSnapshot = false,
}: {
  condition: string;
  initialSnapshot?: boolean;
}) {
  const [data, setData] = useState<Investigation | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0),
    [snapshot, setSnapshot] = useState(initialSnapshot),
    [tab, setTab] = useState<Tab>("integrity"),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(0),
    [scanCount, setScanCount] = useState(3),
    [busy, setBusy] = useState(""),
    [reportBusy, setReportBusy] = useState(""),
    [actionError, setActionError] = useState(""),
    [scanned, setScanned] = useState<{
      key: string;
      results: ParticipantAudit[];
    } | null>(null),
    [focused, setFocused] = useState("");
  const key = data ? `${condition}:${data.bundle.provenance.fetchedAt}` : "";
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setError("");
    setData(null);
    setActionError("");
    requestJson<Investigation>(
      `/api/market/${condition}?${new URLSearchParams({ snapshot: snapshot ? "1" : "0", refresh: refresh ? "1" : "0" })}`,
      { signal: c.signal },
    )
      .then((value) => {
        if (!c.signal.aborted) setData(value);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [condition, snapshot, refresh]);
  useEffect(() => {
    setPage(0);
  }, [query]);
  useEffect(() => {
    if (focused && tab === "overview")
      document
        .getElementById(`signal-${focused}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focused, tab]);
  async function scan() {
    if (!data) return;
    const currentKey = key;
    setBusy(currentKey);
    setActionError("");
    try {
      const result = await requestJson<{ results: ParticipantAudit[] }>(
        `/api/market/${condition}/scan`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            count: Math.min(scanCount, data.audit.participants.length),
            snapshot,
            fetchedAt: data.bundle.provenance.fetchedAt,
          }),
        },
      );
      setScanned({ key: currentKey, results: result.results });
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : "Participant scan failed.",
      );
    } finally {
      setBusy((previous) => (previous === currentKey ? "" : previous));
    }
  }
  async function generate() {
    if (!data) return;
    const stamp = data.bundle.provenance.fetchedAt,
      currentKey = key;
    setReportBusy(currentKey);
    setActionError("");
    try {
      const result = await requestJson<{ report: Report }>(
        `/api/market/${condition}/report`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ snapshot, fetchedAt: stamp }),
        },
      );
      setData((previous) =>
        previous?.bundle.market.condition === condition &&
        previous.bundle.provenance.fetchedAt === stamp
          ? { ...previous, report: result.report }
          : previous,
      );
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : "Local explanation failed.",
      );
    } finally {
      setReportBusy((previous) => (previous === currentKey ? "" : previous));
    }
  }
  const participants =
      data?.audit.participants.filter((p) =>
        `${p.address} ${p.name}`.toLowerCase().includes(query.toLowerCase()),
      ) || [],
    pages = Math.max(1, Math.ceil(participants.length / 15)),
    currentPage = Math.min(page, pages - 1),
    results = new Map(
      (scanned?.key === key ? scanned.results : []).map((r) => [r.address, r]),
    );
  const bundle = data?.bundle,
    audit = data?.audit,
    market = bundle?.market;
  return (
    <AppFrame active="markets">
      <main>
        <div className="breadcrumbs market-breadcrumb">
          <Link href="/">
            <ArrowLeft size={13} />
            Market explorer
          </Link>
          <span>/</span>
          <span>Investigation</span>
        </div>
        <div className="page-heading market-page-heading">
          <div className="pm-market-title">
            {market?.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="pm-thumb large" src={market.image} alt="" />
            ) : (
              <span className="pm-thumb large" aria-hidden="true" />
            )}
            <div>
              <h1>{market?.title || "Market investigation"}</h1>
              <p>
                {market
                  ? `${market.closed ? "Resolved" : market.active ? "Live" : "Status unavailable"} · ${market.tags.join(" · ") || "Public trading records"}`
                  : "Retrieving market metadata and the trade tape"}
              </p>
              {market && market.outcomes[0]?.price != null ? (
                <div className="pm-chance">
                  {market.closed && (market.outcomes[0].price >= 0.99 || market.outcomes[0].price <= 0.01) ? (
                    <strong className={market.outcomes[0].price >= 0.99 ? "positive" : "negative"}>
                      Resolved {market.outcomes[0].price >= 0.99 ? market.outcomes[0].label : market.outcomes[1]?.label}
                    </strong>
                  ) : (
                    <>
                      <strong>{Math.round(market.outcomes[0].price * 100)}%</strong>
                      <span>chance · {market.outcomes[0].label}</span>
                    </>
                  )}
                </div>
              ) : null}
            </div>
          </div>
          <div className="heading-actions">
            <button
              className="outline-button"
              disabled={!data}
              onClick={() =>
                download(
                  `luckaudit-market-${condition}.json`,
                  JSON.stringify(
                    {
                      ...data,
                      participantAudits:
                        scanned?.key === key ? scanned.results : [],
                    },
                    null,
                    2,
                  ),
                  "application/json",
                )
              }
            >
              <Download size={14} />
              Export audit
            </button>
            {market?.eventSlug ? (
              <a
                className="primary-button"
                href={`https://polymarket.com/event/${encodeURIComponent(market.eventSlug)}`}
                target="_blank"
                rel="noreferrer"
              >
                Market page
                <ExternalLink size={14} />
              </a>
            ) : null}
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
              ? `Retrieved ${dateTime(bundle.provenance.fetchedAt)}`
              : "Metadata, wallet-side fills, holdings and resolution records"}
          </span>
          <div className="source-actions">
            <select
              aria-label="Market data mode"
              value={snapshot ? "snapshot" : "live"}
              onChange={(e) => setSnapshot(e.target.value === "snapshot")}
            >
              <option value="live">Live data</option>
              <option value="snapshot">Saved snapshot</option>
            </select>
            <button
              className="icon-button"
              disabled={loading}
              aria-label="Refresh market records"
              onClick={() => setRefresh((x) => x + 1)}
            >
              <RefreshCw size={15} className={loading ? "spin" : ""} />
            </button>
          </div>
        </div>
        {loading ? (
          <div className="loading-state investigation-loading" role="status">
            <LoaderCircle className="spin" size={27} />
            <h2>Reading the market’s public activity</h2>
            <p>
              Collecting the trade tape, measuring observed concentration, and
              checking persistent price rises. Wallet histories are audited
              separately on demand.
            </p>
          </div>
        ) : error ? (
          <div className="empty-state" role="alert">
            <Info size={25} />
            <h2>Market investigation unavailable</h2>
            <p>{error}</p>
            <button
              className="outline-button"
              onClick={() => setRefresh((x) => x + 1)}
            >
              Retry
              <RefreshCw size={14} />
            </button>
          </div>
        ) : data && bundle && market && audit ? (
          <>
            {bundle.provenance.warning ? (
              <div className="inline-notice warning">
                <Info size={15} />
                {bundle.provenance.warning}
              </div>
            ) : null}
            {bundle.tape.coverage.warnings.length ? (
              <div className="inline-notice warning">
                <Info size={15} />
                <span>{bundle.tape.coverage.warnings.join(" ")}</span>
              </div>
            ) : null}
            <div className="market-scope-banner">
              <ShieldCheck size={17} />
              <span>
                <strong>Wallet analysis, not an accusation.</strong> Flags mean
                records unlikely under market odds, consistent with skill,
                speed, or information.
              </span>
              <Link href="/method">
                Validation
                <ArrowUpRight size={13} />
              </Link>
            </div>
            <nav
              className="investigation-tabs"
              aria-label="Market investigation sections"
            >
              {(["integrity", "overview", "activity", "traders", "report"] as Tab[]).map(
                (value) => (
                  <button
                    key={value}
                    className={value === tab ? "selected" : ""}
                    aria-current={value === tab ? "page" : undefined}
                    onClick={() => {
                      setTab(value);
                      setActionError("");
                    }}
                  >
                    {value === "integrity"
                      ? "Trader check"
                      : value === "overview"
                      ? "Overview"
                      : value === "activity"
                        ? "Activity & timing"
                        : value === "traders"
                          ? "Participating traders"
                          : "Report"}
                    {value === "traders" ? (
                      <span>{audit.participants.length}</span>
                    ) : null}
                  </button>
                ),
              )}
            </nav>
            {actionError ? (
              <div className="inline-notice warning" role="alert">
                <Info size={15} />
                {actionError}
              </div>
            ) : null}
            {tab === "integrity" ? <IntegrityPanel condition={condition} /> : null}
            {tab === "overview" ? (
              <>
                <section className="audit-stats market-audit-stats">
                  <Stat
                    title="Observed participants"
                    value={compact(audit.summary.wallets)}
                    note={`${compact(audit.summary.fills)} wallet-side fills`}
                  />
                  <Stat
                    title="Observed turnover"
                    value={money(audit.summary.observedNotional)}
                    note="Execution notional; both wallet sides"
                  />
                  <Stat
                    title="Largest five wallets"
                    value={
                      audit.summary.topFiveShare === null
                        ? "—"
                        : `${(audit.summary.topFiveShare * 100).toFixed(1)}%`
                    }
                    note="Share of observed turnover"
                  />
                  <Stat
                    title="Verdict"
                    value="See Trader check"
                    note="From traders' records in other markets"
                  />
                </section>
                <div className="analysis-grid">
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>Observed price timeline</h2>
                        <p>
                          {audit.summary.from !== null &&
                          audit.summary.to !== null
                            ? `${dateTime(audit.summary.from)} — ${dateTime(audit.summary.to)}`
                            : "No valid trading window"}
                        </p>
                      </div>
                    </div>
                    <PriceTimeline audit={audit} market={market} />
                    <p className="panel-footnote">
                      Prices come from fetched trades, not a live order book.
                      Empty bins are not filled with inferred prices.
                    </p>
                  </section>
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>Market context</h2>
                        <p>
                          Gamma metadata; values may update independently of the
                          tape
                        </p>
                      </div>
                    </div>
                    <dl className="market-context">
                      <div>
                        <dt>Reported volume</dt>
                        <dd>{money(market.volumeUsd)}</dd>
                      </div>
                      <div>
                        <dt>Reported liquidity</dt>
                        <dd>{money(market.liquidityUsd)}</dd>
                      </div>
                      <div>
                        <dt>Scheduled end</dt>
                        <dd>
                          {market.endTime
                            ? dateTime(market.endTime)
                            : "Unavailable"}
                        </dd>
                      </div>
                      <div>
                        <dt>Resolution records</dt>
                        <dd>
                          {bundle.tape.resolutions
                            .map((r) => r.status)
                            .join(", ") || "Unavailable"}
                        </dd>
                      </div>
                      <div>
                        <dt>Observed holdings</dt>
                        <dd>
                          {audit.summary.heldShares === null
                            ? "Unavailable"
                            : `${compact(audit.summary.heldShares)} shares`}
                        </dd>
                      </div>
                    </dl>
                    <div className="outcome-preview">
                      {market.outcomes.map((o, i) => (
                        <div key={i}>
                          <span>{o.label}</span>
                          <strong>
                            {o.price === null
                              ? "—"
                              : `${(o.price * 100).toFixed(1)}%`}
                          </strong>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Activity evidence</h2>
                      <p>
                        These descriptive observations are not significance
                        tests.
                      </p>
                    </div>
                    <button
                      className="outline-button"
                      onClick={() => setTab("activity")}
                    >
                      Inspect activity
                      <ArrowRight size={14} />
                    </button>
                  </div>
                  <div className="market-signals">
                    {audit.signals.map((s) => (
                      <article
                        key={s.id}
                        id={`signal-${s.id}`}
                        className={focused === s.id ? "focused-signal" : ""}
                      >
                        <span className="evidence-id">{s.id}</span>
                        <div>
                          <h3>{s.title}</h3>
                          <p>{s.text}</p>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Who is trading this market?</h2>
                      <p>
                        Use multi-event wallet histories to examine repeat
                        performance.
                      </p>
                    </div>
                    <button
                      className="primary-button"
                      onClick={() => setTab("traders")}
                    >
                      <Users size={15} />
                      Inspect participants
                    </button>
                  </div>
                  <div className="concentration-bars">
                    {audit.participants.slice(0, 5).map((p) => (
                      <Link key={p.address} href={`/wallet/${p.address}`}>
                        <span>{shortAddress(p.address)}</span>
                        <i>
                          <b style={{ width: `${p.turnoverShare * 100}%` }} />
                        </i>
                        <strong>{(p.turnoverShare * 100).toFixed(1)}%</strong>
                        <ArrowUpRight size={13} />
                      </Link>
                    ))}
                  </div>
                </section>
                {market.description ? (
                  <details className="panel market-rules">
                    <summary>Market rules and resolution description</summary>
                    <p>{market.description}</p>
                  </details>
                ) : null}
              </>
            ) : null}
            {tab === "activity" ? (
              <>
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Largest observed trades</h2>
                      <p>
                        Ranked by execution notional on wallet-side records.
                        Maker/taker records can refer to the same fill.
                      </p>
                    </div>
                  </div>
                  <div className="table-scroll">
                    <table className="records-table">
                      <thead>
                        <tr>
                          <th>Wallet</th>
                          <th>Side / outcome</th>
                          <th>Notional</th>
                          <th>Price</th>
                          <th>Time / evidence</th>
                        </tr>
                      </thead>
                      <tbody>
                        {audit.largeTrades.map((t, i) => (
                          <tr key={`${t.transaction_hash}-${i}`}>
                            <td>
                              <Link
                                className="evidence-link"
                                href={`/wallet/${t.proxy_wallet}`}
                              >
                                {shortAddress(t.proxy_wallet)}
                                <ArrowUpRight size={12} />
                              </Link>
                            </td>
                            <td>
                              {t.side}
                              <span className="cell-subline">{t.outcome}</span>
                            </td>
                            <td>{money(t.size * t.price)}</td>
                            <td>{(t.price * 100).toFixed(1)}%</td>
                            <td>
                              <span className="cell-subline">
                                {dateTime(t.timestamp)}
                              </span>
                              {/^0x[\da-f]{64}$/i.test(t.transaction_hash) ? (
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
                  {!audit.largeTrades.length ? (
                    <p className="chart-empty">No valid trade records.</p>
                  ) : null}
                </section>
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Timing before the big move</h2>
                      <p>
                        For resolved markets, buying in the 6 hours before a big price move is compared with every
                        earlier window. It is shown as context in the Trader check tab and never decides the verdict.
                      </p>
                    </div>
                    <button className="outline-button" onClick={() => setTab("integrity")}>
                      Open the trader check
                      <ArrowRight size={14} />
                    </button>
                  </div>
                </section>
              </>
            ) : null}
            {tab === "traders" ? (
              <section className="panel positions-panel">
                <div className="panel-heading">
                  <div>
                    <h2>Participating traders</h2>
                    <p>
                      Ranked by observed turnover in this market. Each trader&apos;s record comes from their bets
                      in other, resolved markets.
                    </p>
                  </div>
                  <div className="simulation-actions">
                    <select
                      aria-label="Number of participants to audit"
                      value={scanCount}
                      onChange={(e) => setScanCount(Number(e.target.value))}
                    >
                      {[1, 3, 5].map((n) => (
                        <option key={n} value={n}>
                          Top {n} {n === 1 ? "wallet" : "wallets"}
                        </option>
                      ))}
                    </select>
                    <button
                      className="primary-button"
                      disabled={!audit.participants.length || busy === key}
                      onClick={scan}
                    >
                      {busy === key ? (
                        <LoaderCircle className="spin" size={14} />
                      ) : (
                        <Users size={14} />
                      )}
                      Test wallet records
                    </button>
                  </div>
                </div>
                <div className="inline-notice">
                  <Info size={15} />
                  <span>
                    {busy === key
                      ? "Retrieving selected participant histories and testing their records. Large wallets may reach coverage limits."
                      : "Wallets tested together form one group: pre-filter at 0.05 ÷ m, then Benjamini–Hochberg at 5%. Unusual means hard to explain by luck, not a finding about this market."}
                  </span>
                </div>
                <div className="evidence-filters">
                  <label className="table-search">
                    <Search size={15} />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      aria-label="Search market participants"
                      placeholder="Search a participating wallet…"
                    />
                  </label>
                  <span className="chart-source-label">
                    {results.size} of {audit.participants.length} histories
                    requested
                  </span>
                </div>
                <div className="table-scroll">
                  <table className="records-table">
                    <thead>
                      <tr>
                        <th>Wallet</th>
                        <th>Observed turnover</th>
                        <th>Share / fills</th>
                        <th>Open shares returned</th>
                        <th>Record test (group-corrected)</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {participants
                        .slice(currentPage * 15, (currentPage + 1) * 15)
                        .map((p) => {
                          const r = results.get(p.address);
                          return (
                            <tr key={p.address}>
                              <td>
                                <Link
                                  className="evidence-link"
                                  href={`/wallet/${p.address}`}
                                >
                                  {shortAddress(p.address)}
                                  <ArrowUpRight size={12} />
                                </Link>
                                <span className="cell-subline">
                                  First observed {dateTime(p.firstObserved)}
                                </span>
                              </td>
                              <td>
                                {money(p.turnover)}
                                <span className="cell-subline">
                                  Buy {money(p.buyNotional)} · Sell{" "}
                                  {money(p.sellNotional)}
                                </span>
                              </td>
                              <td>
                                {(p.turnoverShare * 100).toFixed(1)}%
                                <span className="cell-subline">
                                  {p.fills.toLocaleString()} fills
                                </span>
                              </td>
                              <td>{compact(p.heldShares)}</td>
                              <td
                                className="participant-assessment"
                                title={r?.reason}
                              >
                                {r ? (
                                  <>
                                    <span
                                      className={`assessment-badge ${r.label === "unusual-record" ? "unusual" : r.label === "nothing-unusual" ? "within-baseline" : "insufficient"}`}
                                    >
                                      {r.label === "unavailable" ? "History unavailable" : RECORD_LABELS[r.label]}
                                    </span>
                                    <span className="cell-subline">
                                      {r.observations
                                        ? `${r.wins} of ${r.observations} won · ${r.expected.toFixed(2)} expected`
                                        : "no qualifying bets"}
                                      {r.q !== null ? ` · q ${r.q < 0.001 ? r.q.toExponential(1) : r.q.toFixed(3)}` : ""}
                                    </span>
                                  </>
                                ) : (
                                  <span className="audit-status">
                                    Not assessed
                                  </span>
                                )}
                              </td>
                              <td>
                                <Link
                                  className="analyze-row"
                                  href={`/wallet/${p.address}`}
                                >
                                  Investigate
                                  <ArrowUpRight size={13} />
                                </Link>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
                {!participants.length ? (
                  <p className="chart-empty">
                    No matching participants in the retrieved tape.
                  </p>
                ) : null}
                <div className="table-footer">
                  <span>{participants.length} observed wallets</span>
                  <div className="pagination">
                    <button
                      aria-label="Previous participants"
                      disabled={!currentPage}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      ←
                    </button>
                    <span>
                      {currentPage + 1} / {pages}
                    </span>
                    <button
                      aria-label="Next participants"
                      disabled={currentPage >= pages - 1}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      →
                    </button>
                  </div>
                </div>
              </section>
            ) : null}
            {tab === "report" ? (
              <>
                <MarketReportTab condition={condition} />
                {/* Optional: an AI rewording, only when local Ollama is running. */}
                {data.aiConfigured ? (
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <span className="report-mode">
                        <FileSearch size={14} />
                        {data.report.mode === "ai"
                          ? "Local AI explanation + computed evidence"
                          : "Computed market activity report"}
                      </span>
                      <h2>{data.report.headline}</h2>
                      <p>
                        {dateTime(data.report.generatedAt)}
                        {data.report.model
                          ? ` · ${data.report.model}`
                          : " · deterministic activity calculations"}
                      </p>
                    </div>
                    <button
                      className="primary-button"
                      disabled={reportBusy === key}
                      onClick={generate}
                    >
                      {reportBusy === key ? (
                        <LoaderCircle className="spin" size={14} />
                      ) : (
                        <Sparkles size={14} />
                      )}
                      {data.aiConfigured ? "Generate local explanation" : "Add integrity evidence"}
                    </button>
                  </div>
                  {!data.aiConfigured ? (
                    <div className="inline-notice">
                      <Info size={15} />
                      Local AI is unavailable. The button adds the integrity
                      test evidence (I1–I3) to this computed report instead.
                    </div>
                  ) : null}
                  <div className="report-findings">
                    {data.report.findings.map((f, i) => (
                      <article key={i}>
                        <h3>{f.title}</h3>
                        <p>{f.text}</p>
                        <div className="report-citations">
                          {f.evidenceIds.map((id) => (
                            <button
                              key={id}
                              onClick={() => {
                                setFocused(id);
                                setTab("overview");
                              }}
                            >
                              {id}
                              <ArrowUpRight size={11} />
                            </button>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
                ) : null}
              </>
            ) : null}
            <footer className="page-footer">
              <span>
                Condition {shortAddress(condition)} · Observed records only
              </span>
              <Link href="/method">
                How reliable are these results?
                <ArrowUpRight size={12} />
              </Link>
            </footer>
          </>
        ) : null}
      </main>
    </AppFrame>
  );
}
function Stat({
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
